import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { GoalNear } from 'baritone-ts';
import { smartPathfinderGoto, sleep } from '../PathfindingUtils';
import type { Logger } from '../logger';
import type { VillageChat, TradeOffer, ActiveTrade, TradeStatus } from '../VillageChat';
import type { InventoryItem, RoleName } from '../ItemCategories';
import { isWantedByRole, getItemCount, getTradeableItems } from '../ItemCategories';

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * Walk toward an item and wait for pickup using event-driven approach.
 * Resolves immediately when item is collected, or after timeout.
 */
function walkTowardAndCollect(
    bot: Bot,
    drop: Entity,
    maxWalkTimeMs: number
): Promise<boolean> {
    return new Promise(resolve => {
        const dropId = drop.id;
        let resolved = false;
        let timeoutHandle: ReturnType<typeof setTimeout>;

        const cleanup = () => {
            if (resolved) return;
            resolved = true;
            bot.clearControlStates();
            bot.removeListener('playerCollect', onCollect);
            clearTimeout(timeoutHandle);
        };

        const onCollect = (collector: Entity, collected: Entity) => {
            if (collected.id === dropId) {
                cleanup();
                resolve(true);
            }
        };

        bot.on('playerCollect', onCollect);

        // Look at item and walk forward
        if (drop.position) {
            const direction = drop.position.minus(bot.entity.position);
            const yaw = Math.atan2(-direction.x, -direction.z);
            bot.look(yaw, 0).then(() => {
                if (!resolved) {
                    bot.setControlState('forward', true);
                }
            });
        }

        // Timeout fallback
        timeoutHandle = setTimeout(() => {
            cleanup();
            // Check if item still exists
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            resolve(!stillExists);
        }, maxWalkTimeMs);
    });
}

// Trade timing constants
const OFFER_COLLECTION_WINDOW = 15000;     // 15 seconds to collect WANT responses
const OFFER_COOLDOWN = 30000;               // 30 seconds between offers
const TRADE_TIMEOUT = 120000;               // 2 minutes max for entire trade
const MIN_TRADEABLE_ITEMS = 4;              // Minimum items to trigger an offer
const MEETING_POINT_RADIUS = 2;             // How close to get to meeting point
const STEP_BACK_DISTANCE = 4;               // Distance to step back after dropping (must be > pickup range of 2)
const GIVER_WAIT_AFTER_DROP = 3000;         // Time giver waits after dropping before considering done
const PICKUP_VERIFICATION_WAIT = 1000;      // Time to wait for items to settle before pickup
const MAX_PARTNER_DISTANCE = 4;             // Maximum allowed distance between trading partners
const MAX_TRADE_RETRIES = 3;                // Maximum number of trade retry attempts
const OTHER_BOT_EXCLUSION_RADIUS = 8;       // Distance at which other bots make a meeting point unsuitable

/**
 * Minimal blackboard interface required by trade actions.
 */
export interface TradeBlackboard {
    villageChat: VillageChat | null;
    tradeableItems: InventoryItem[];
    tradeableItemCount: number;
    pendingTradeOffers: TradeOffer[];
    activeTrade: ActiveTrade | null;
    lastOfferTime: number;
    consecutiveNoTakers: number;  // Consecutive "no takers" results for exponential backoff
    spawnPosition: Vec3 | null;
    villageCenter?: Vec3 | null;
    log?: Logger | null;
    lastAction: string;
    inventoryFull: boolean;
}

/**
 * Configuration for trade behavior.
 */
export interface TradeConfig {
    /** The role name for item categorization */
    role: RoleName;
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** Minimum tradeable items to trigger an offer (default: 4) */
    minTradeableItems?: number;
    /** Cooldown between offers in ms (default: 30000) */
    offerCooldown?: number;
}

const DEFAULT_CONFIG: Required<TradeConfig> = {
    role: 'farmer',
    roleLabel: 'Bot',
    minTradeableItems: MIN_TRADEABLE_ITEMS,
    offerCooldown: OFFER_COOLDOWN,
};

/**
 * Base class for broadcasting trade offers.
 *
 * Handles the giver flow:
 * 1. Check if we have enough tradeable items
 * 2. Broadcast offer
 * 3. Wait for WANT responses (5 second window)
 * 4. Select neediest bot
 * 5. Accept trade and send meeting point
 */
export abstract class BaseBroadcastOffer<TBlackboard extends TradeBlackboard> {
    readonly name = 'BroadcastOffer';
    protected config: Required<TradeConfig>;

    constructor(config: TradeConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if we should broadcast an offer.
     * Uses exponential backoff based on consecutive "no takers" results.
     */
    canOffer(bb: TBlackboard): boolean {
        if (!bb.villageChat) return false;
        if (bb.villageChat.isInTrade()) return false;

        const now = Date.now();

        // Calculate effective cooldown with exponential backoff
        // Base: 30s, then 60s, 120s, 240s... up to 10 minutes max
        const backoffMultiplier = Math.pow(2, Math.min(bb.consecutiveNoTakers, 5));
        const effectiveCooldown = Math.min(
            this.config.offerCooldown * backoffMultiplier,
            10 * 60 * 1000  // Max 10 minutes
        );

        if (now - bb.lastOfferTime < effectiveCooldown) return false;

        return bb.tradeableItemCount >= this.config.minTradeableItems;
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';

        const trade = bb.villageChat.getActiveTrade();

        // State machine based on trade status
        if (!trade || trade.status === 'idle') {
            // Not in a trade, check if we should offer
            if (!this.canOffer(bb)) return 'failure';

            // Find best item to offer (highest count)
            const bestItem = bb.tradeableItems[0];
            if (!bestItem || bestItem.count < this.config.minTradeableItems) {
                return 'failure';
            }

            // Broadcast offer
            bb.villageChat.broadcastTradeOffer(bestItem.name, bestItem.count);
            bb.lastOfferTime = Date.now();
            bb.lastAction = 'trade_offering';
            bb.log?.info({ item: bestItem.name, qty: bestItem.count }, `[${this.config.roleLabel}] Broadcast trade offer`);

            return 'running';
        }

        if (trade.status === 'offering') {
            // Collecting WANT responses
            const elapsed = Date.now() - trade.offerTimestamp;

            if (elapsed < OFFER_COLLECTION_WINDOW) {
                bb.lastAction = 'trade_collecting_wants';
                // Yield to event loop to ensure keepalives are processed
                await sleep(50);
                return 'running';
            }

            // Time's up - select the neediest bot
            const neediest = bb.villageChat.selectNeediestBot();
            if (!neediest) {
                // Track consecutive "no takers" for exponential backoff
                bb.consecutiveNoTakers = (bb.consecutiveNoTakers || 0) + 1;
                const backoffTime = Math.min(
                    this.config.offerCooldown * Math.pow(2, Math.min(bb.consecutiveNoTakers, 5)),
                    10 * 60 * 1000
                );
                bb.log?.debug({
                    consecutiveNoTakers: bb.consecutiveNoTakers,
                    nextAttemptIn: `${Math.round(backoffTime / 1000)}s`
                }, `[${this.config.roleLabel}] No takers for trade offer, backing off`);
                bb.villageChat.clearActiveTrade();
                return 'failure';
            }

            // Reset consecutive failures on successful trade initiation
            bb.consecutiveNoTakers = 0;

            // Accept the trade
            bb.villageChat.acceptTrade(neediest.from);

            // Send meeting point
            const meetingPoint = this.getMeetingPoint(bot, bb);
            bb.villageChat.sendMeetingPoint(meetingPoint);

            bb.lastAction = 'trade_accepted';
            bb.log?.info({ partner: neediest.from, pos: meetingPoint.floored().toString() },
                `[${this.config.roleLabel}] Accepted trade, meeting at`);

            return 'success';
        }

        // Offer was broadcast and we're now in a later phase
        return 'success';
    }

    protected getMeetingPoint(bot: Bot, bb: TBlackboard): Vec3 {
        // Get the partner name from trade state
        const trade = bb.villageChat?.getActiveTrade();
        const partnerName = trade?.partner;

        // Try several potential meeting points, checking each for other bots/players
        const potentialPoints: Vec3[] = [];

        if (bb.villageCenter) {
            // Try multiple offsets from village center
            potentialPoints.push(bb.villageCenter.offset(3, 0, 3));
            potentialPoints.push(bb.villageCenter.offset(-3, 0, 3));
            potentialPoints.push(bb.villageCenter.offset(3, 0, -3));
            potentialPoints.push(bb.villageCenter.offset(-3, 0, -3));
        }

        if (bb.spawnPosition) {
            potentialPoints.push(bb.spawnPosition.offset(3, 0, 3));
            potentialPoints.push(bb.spawnPosition.offset(-3, 0, 3));
        }

        // Fallback: offset from current position
        potentialPoints.push(bot.entity.position.offset(3, 0, 0));

        // Find a meeting point that's clear of other bots/players and trade zones
        for (const point of potentialPoints) {
            if (this.isMeetingPointClear(bot, bb, point, partnerName)) {
                return point;
            }
        }

        // If no clear point found, use the first option anyway (better than nothing)
        bb.log?.warn('No clear meeting point found, using default');
        return potentialPoints[0]!;
    }

    /**
     * Check if a meeting point is clear of other bots/players and active trade zones.
     */
    protected isMeetingPointClear(bot: Bot, bb: TBlackboard, point: Vec3, partnerName?: string): boolean {
        // Check for active trade zones from other trades
        if (bb.villageChat?.isInOtherTradeZone(point)) {
            bb.log?.debug({ point: point.floored().toString() }, 'Meeting point rejected: in active trade zone');
            return false;
        }

        for (const entity of Object.values(bot.entities)) {
            if (!entity.position) continue;
            if (entity.username === bot.username) continue; // Skip self
            if (partnerName && entity.username === partnerName) continue; // Skip trade partner

            // Check if this entity is a player/bot
            if (entity.type === 'player') {
                const dist = entity.position.distanceTo(point);
                if (dist < OTHER_BOT_EXCLUSION_RADIUS) {
                    return false; // Too close to another player/bot
                }
            }
        }
        return true;
    }
}

/**
 * Base class for responding to trade offers.
 *
 * Handles the receiver flow:
 * 1. Check for offers we want
 * 2. Send WANT response with our current count
 */
export abstract class BaseRespondToOffer<TBlackboard extends TradeBlackboard> {
    readonly name = 'RespondToOffer';
    protected config: Required<TradeConfig>;

    constructor(config: TradeConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if there's an offer we want.
     */
    hasWantedOffer(bb: TBlackboard): boolean {
        if (!bb.villageChat) return false;
        if (bb.villageChat.isInTrade()) return false;
        return bb.pendingTradeOffers.length > 0;
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';
        if (bb.villageChat.isInTrade()) return 'failure';

        // Find first offer for an item we want
        const offer = bb.pendingTradeOffers[0];
        if (!offer) return 'failure';

        // Get our current count of this item
        const inv = bot.inventory.items();
        const currentCount = inv
            .filter(i => i.name === offer.item)
            .reduce((sum, i) => sum + i.count, 0);

        // Send WANT response
        bb.villageChat.sendWantResponse(offer, currentCount);
        bb.lastAction = 'trade_wanting';
        bb.log?.info({ item: offer.item, from: offer.from, have: currentCount },
            `[${this.config.roleLabel}] Responded to trade offer`);

        return 'success';
    }
}

/**
 * Base class for traveling to trade meeting point.
 */
export abstract class BaseTravelToTrade<TBlackboard extends TradeBlackboard> {
    readonly name = 'TravelToTrade';
    protected config: Required<TradeConfig>;

    constructor(config: TradeConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if we should travel.
     */
    shouldTravel(bb: TBlackboard): boolean {
        const trade = bb.activeTrade;
        if (!trade) return false;
        if (!trade.meetingPoint) return false;
        return trade.status === 'traveling' || trade.status === 'accepted';
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';

        const trade = bb.activeTrade;
        if (!trade || !trade.meetingPoint) return 'failure';

        const pos = bot.entity.position;
        const dist = pos.distanceTo(trade.meetingPoint);

        // Already at meeting point?
        if (dist <= MEETING_POINT_RADIUS) {
            bb.villageChat.sendTradeReady();
            bb.lastAction = 'trade_ready';
            bb.log?.debug(`[${this.config.roleLabel}] Arrived at trade meeting point`);
            return 'success';
        }

        // Travel to meeting point
        bb.lastAction = 'trade_traveling';
        bb.log?.debug({ dest: trade.meetingPoint.floored().toString(), dist: dist.toFixed(1) },
            `[${this.config.roleLabel}] Traveling to trade meeting point`);

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(trade.meetingPoint.x, trade.meetingPoint.y, trade.meetingPoint.z, MEETING_POINT_RADIUS),
                { timeoutMs: 30000 }
            );

            if (!result.success) {
                bb.log?.warn({ reason: result.failureReason },
                    `[${this.config.roleLabel}] Failed to reach trade meeting point`);
                return 'failure';
            }

            // Send ready signal
            bb.villageChat.sendTradeReady();
            bb.lastAction = 'trade_ready';
            bb.log?.debug(`[${this.config.roleLabel}] Arrived and ready for trade`);

            return 'success';
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'unknown';
            if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                bb.log?.debug({ err: msg }, `[${this.config.roleLabel}] Travel to trade error`);
            }
            return 'failure';
        }
    }
}

/**
 * Base class for executing the trade exchange.
 *
 * For giver: wait for partner ready, drop items, step back
 * For receiver: wait for items dropped, pick up items
 */
export abstract class BaseExecuteTrade<TBlackboard extends TradeBlackboard> {
    readonly name = 'ExecuteTrade';
    protected config: Required<TradeConfig>;

    constructor(config: TradeConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if we should execute.
     */
    shouldExecute(bb: TBlackboard): boolean {
        const trade = bb.activeTrade;
        if (!trade) return false;
        return trade.status === 'ready' ||
               trade.status === 'dropping' ||
               trade.status === 'picking_up';
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';

        const trade = bb.activeTrade;
        if (!trade) return 'failure';

        if (trade.role === 'giver') {
            return this.executeGiver(bot, bb, trade);
        } else {
            return this.executeReceiver(bot, bb, trade);
        }
    }

    private async executeGiver(bot: Bot, bb: TBlackboard, trade: ActiveTrade): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';

        // Wait for partner to be ready
        if (!trade.partnerReady && trade.status === 'ready') {
            bb.lastAction = 'trade_waiting_partner';

            // Check for timeout
            const elapsed = Date.now() - trade.offerTimestamp;
            if (elapsed > TRADE_TIMEOUT) {
                bb.log?.warn(`[${this.config.roleLabel}] Trade timeout waiting for partner`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            return 'running';
        }

        // Partner is ready - drop items
        if (trade.status === 'ready') {
            bb.villageChat.setTradeStatus('dropping');
        }

        if (trade.status === 'dropping') {
            bb.lastAction = 'trade_dropping';

            // Find the items to drop - must match trade item EXACTLY
            const itemSlot = bot.inventory.items().find(i => i.name === trade.item);
            if (!itemSlot) {
                bb.log?.warn({ item: trade.item, inventory: bot.inventory.items().map(i => i.name) },
                    `[${this.config.roleLabel}] Trade item not found in inventory - cancelling trade`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            // Verify we're dropping the correct item (defensive check)
            if (itemSlot.name !== trade.item) {
                bb.log?.warn({ expected: trade.item, found: itemSlot.name },
                    `[${this.config.roleLabel}] Item mismatch - cancelling trade`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            // Drop ONLY the offered quantity, not the entire stack
            const dropCount = Math.min(itemSlot.count, trade.quantity);
            try {
                // Use toss() with count instead of tossStack() to drop only offered amount
                await bot.toss(itemSlot.type, itemSlot.metadata, dropCount);
                bb.log?.info({ item: trade.item, qty: dropCount, hadInStack: itemSlot.count },
                    `[${this.config.roleLabel}] Dropped trade items`);
            } catch (error) {
                bb.log?.warn({ err: error, item: trade.item },
                    `[${this.config.roleLabel}] Failed to drop items`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            // Step back far enough to avoid accidentally picking up items (pickup range is ~2 blocks)
            const meetingPoint = trade.meetingPoint || bot.entity.position;
            const stepBackDir = bot.entity.position.clone()
                .subtract(meetingPoint)
                .normalize();
            // If we're at the meeting point, pick a direction away
            if (stepBackDir.norm() < 0.1) {
                stepBackDir.x = 1;
                stepBackDir.z = 0;
            }
            const stepBackPos = meetingPoint.clone()
                .add(stepBackDir.scaled(STEP_BACK_DISTANCE));

            try {
                await smartPathfinderGoto(
                    bot,
                    new GoalNear(stepBackPos.x, stepBackPos.y, stepBackPos.z, 1),
                    { timeoutMs: 5000 }
                );
                bb.log?.debug({ pos: stepBackPos.floored().toString() },
                    `[${this.config.roleLabel}] Stepped back from meeting point`);
            } catch {
                // If step back fails, manually walk away to avoid pickup
                bb.log?.debug(`[${this.config.roleLabel}] Step back pathfinding failed, trying manual walk`);
                bot.setControlState('back', true);
                await sleep(1000);
                bot.setControlState('back', false);
            }

            // Signal items dropped - status changes to 'awaiting_pickup'
            bb.villageChat.sendTradeDropped();

            // Don't complete yet - return running to let tick be called again
            // Trade will complete when receiver sends TRADE_DONE (which clears our trade state)
            bb.lastAction = 'trade_awaiting_pickup';
            return 'running';
        }

        // Giver is waiting for receiver to pick up and confirm
        if (trade.status === 'awaiting_pickup') {
            bb.lastAction = 'trade_awaiting_pickup';

            // Check if receiver already completed (they send TRADE_DONE which clears our trade state)
            if (!bb.villageChat.isInTrade()) {
                bb.lastAction = 'trade_done';
                bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver) - receiver confirmed`);
                return 'success';
            }

            // Check for timeout - receiver should pick up within reasonable time
            const elapsed = Date.now() - trade.offerTimestamp;
            if (elapsed > TRADE_TIMEOUT) {
                bb.log?.warn(`[${this.config.roleLabel}] Trade timeout waiting for receiver to pick up`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            // Keep waiting
            await sleep(1000);
            return 'running';
        }

        return 'running';
    }

    private async executeReceiver(bot: Bot, bb: TBlackboard, trade: ActiveTrade): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';

        // Wait for partner to be ready
        if (!trade.partnerReady && trade.status === 'ready') {
            bb.lastAction = 'trade_waiting_partner';

            // Check for timeout
            const elapsed = Date.now() - trade.offerTimestamp;
            if (elapsed > TRADE_TIMEOUT) {
                bb.log?.warn(`[${this.config.roleLabel}] Trade timeout waiting for partner`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            return 'running';
        }

        // Wait for items to be dropped
        if (trade.status === 'ready' && trade.partnerReady) {
            bb.lastAction = 'trade_waiting_drop';
            return 'running';
        }

        // Pick up items (status is 'picking_up')
        if (trade.status === 'picking_up') {
            bb.lastAction = 'trade_picking_up';

            // Record inventory BEFORE pickup to verify we actually received items
            const countBefore = bot.inventory.items()
                .filter(i => i.name === trade.item)
                .reduce((sum, i) => sum + i.count, 0);

            // Wait a moment for items to settle on ground
            await sleep(PICKUP_VERIFICATION_WAIT);

            // Find dropped items near meeting point
            const meetingPoint = trade.meetingPoint || bot.entity.position;
            const droppedItems = Object.values(bot.entities).filter(e =>
                e.name === 'item' &&
                e.position &&
                e.position.distanceTo(meetingPoint) < 5
            );

            if (droppedItems.length === 0) {
                bb.log?.debug(`[${this.config.roleLabel}] No dropped items found yet, waiting...`);

                // Check for timeout
                const elapsed = Date.now() - trade.offerTimestamp;
                if (elapsed > TRADE_TIMEOUT) {
                    bb.log?.warn(`[${this.config.roleLabel}] Trade timeout - no items appeared`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                await sleep(1000);
                return 'running';
            }

            // Move to collect items (walk to each dropped item)
            bb.log?.debug({ itemCount: droppedItems.length },
                `[${this.config.roleLabel}] Found dropped items, collecting`);

            for (const drop of droppedItems) {
                if (!drop.position) continue;

                const dist = bot.entity.position.distanceTo(drop.position);
                if (dist > 1.5) {
                    try {
                        await smartPathfinderGoto(
                            bot,
                            new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1),
                            { timeoutMs: 5000 }
                        );
                    } catch {
                        // Try to continue collecting other items
                    }
                }
                await sleep(300);
            }

            // Wait a moment for items to enter inventory
            await sleep(500);

            // Verify inventory AFTER pickup - check we received the correct item
            const countAfter = bot.inventory.items()
                .filter(i => i.name === trade.item)
                .reduce((sum, i) => sum + i.count, 0);

            const actualReceived = countAfter - countBefore;

            if (actualReceived <= 0) {
                // We didn't receive any of the traded item - trade may have failed
                bb.log?.warn({
                    item: trade.item,
                    countBefore,
                    countAfter,
                    expectedQty: trade.quantity
                }, `[${this.config.roleLabel}] Trade verification failed - did not receive expected item`);

                // Don't immediately fail - items might still be on ground
                // Check if there are still items to pick up
                const remainingItems = Object.values(bot.entities).filter(e =>
                    e.name === 'item' &&
                    e.position &&
                    e.position.distanceTo(meetingPoint) < 5
                );

                if (remainingItems.length > 0) {
                    bb.log?.debug(`[${this.config.roleLabel}] Still items on ground, retrying pickup`);
                    return 'running';
                }

                // No items received and none on ground - consider trade complete anyway
                // (giver may have dropped, items may have been picked up by receiver)
                bb.log?.warn(`[${this.config.roleLabel}] Trade may have partially failed, completing anyway`);
            } else {
                bb.log?.info({
                    item: trade.item,
                    received: actualReceived,
                    expected: trade.quantity
                }, `[${this.config.roleLabel}] Trade verification successful`);
            }

            // Signal done - receiver confirms they've collected items
            bb.villageChat.sendTradeDone();
            bb.lastAction = 'trade_done';
            bb.log?.info(`[${this.config.roleLabel}] Trade complete (receiver)`);

            return 'success';
        }

        return 'running';
    }
}

/**
 * Combined trade action that handles the complete trade flow.
 * Can be used as a single behavior node.
 */
export abstract class BaseCompleteTrade<TBlackboard extends TradeBlackboard> {
    readonly name = 'CompleteTrade';
    protected config: Required<TradeConfig>;

    constructor(config: TradeConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if we're in an active trade that needs completing.
     */
    isInActiveTrade(bb: TBlackboard): boolean {
        const trade = bb.activeTrade;
        if (!trade) return false;

        const activeStatuses: TradeStatus[] = [
            'accepted', 'traveling', 'ready', 'dropping', 'picking_up'
        ];
        return activeStatuses.includes(trade.status);
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        if (!bb.villageChat) return 'failure';

        const trade = bb.activeTrade;
        if (!trade) return 'failure';

        switch (trade.status) {
            case 'wanting': {
                // Receiver: We've sent WANT, waiting for giver to accept us
                bb.lastAction = 'trade_waiting_for_acceptance';

                const elapsed = Date.now() - trade.offerTimestamp;
                if (elapsed > TRADE_TIMEOUT) {
                    bb.log?.warn(`[${this.config.roleLabel}] Timed out waiting for trade acceptance`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Wait for TRADE_ACCEPT from giver (status will change via chat handler)
                bb.log?.debug(`[${this.config.roleLabel}] Waiting to be selected by trade giver...`);
                await sleep(100);
                return 'running';
            }

            case 'accepted':
            case 'traveling': {
                // Travel to meeting point
                if (!trade.meetingPoint) {
                    // Receiver is waiting for [TRADE_AT] message from giver - this is normal
                    // The giver sends [TRADE_ACCEPT] then [TRADE_AT], so there's a brief window
                    // where the receiver is in 'accepted' status without a meeting point yet
                    const elapsed = Date.now() - trade.offerTimestamp;
                    if (elapsed > TRADE_TIMEOUT) {
                        bb.log?.warn(`[${this.config.roleLabel}] Timed out waiting for meeting point`);
                        bb.villageChat.cancelTrade();
                        return 'failure';
                    }
                    bb.lastAction = 'trade_waiting_for_meetingpoint';
                    bb.log?.debug(`[${this.config.roleLabel}] Waiting for meeting point from trade partner...`);
                    return 'running';
                }

                const dist = bot.entity.position.distanceTo(trade.meetingPoint);
                if (dist <= MEETING_POINT_RADIUS) {
                    bb.villageChat.sendTradeReady();
                    return 'running';
                }

                bb.lastAction = 'trade_traveling';
                const pathResult = await smartPathfinderGoto(
                    bot,
                    new GoalNear(trade.meetingPoint.x, trade.meetingPoint.y, trade.meetingPoint.z, MEETING_POINT_RADIUS),
                    { timeoutMs: 30000 }
                );

                // Only send ready if we actually arrived at the meeting point
                const finalDist = bot.entity.position.distanceTo(trade.meetingPoint);
                if (pathResult.success || finalDist <= MEETING_POINT_RADIUS) {
                    bb.log?.debug({ distance: finalDist.toFixed(1) }, `[${this.config.roleLabel}] Arrived at meeting point`);
                    bb.villageChat.sendTradeReady();
                } else {
                    // Failed to reach meeting point
                    bb.log?.debug({
                        reason: pathResult.failureReason,
                        distance: finalDist.toFixed(1)
                    }, `[${this.config.roleLabel}] Travel to meeting point failed, retrying`);
                    // Don't send ready - let the action retry
                }
                return 'running';
            }

            case 'ready': {
                // Wait for partner or execute trade
                bb.lastAction = 'trade_ready';

                const elapsed = Date.now() - trade.offerTimestamp;
                if (elapsed > TRADE_TIMEOUT) {
                    bb.log?.warn(`[${this.config.roleLabel}] Trade timeout`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Share our position with partner
                bb.villageChat.sendTradePosition(bot.entity.position);

                if (!trade.partnerReady) {
                    // Re-send TRADE_READY periodically in case partner missed the first one
                    // This fixes the "stuck in ready state" bug where both bots wait for each other
                    bb.villageChat.resendTradeReadyIfNeeded();

                    // Yield to event loop to allow chat messages to be processed
                    await sleep(100);
                    return 'running';
                }

                // Verify proximity: both bots must be close to each other
                if (trade.partnerPosition) {
                    const distanceToPartner = bot.entity.position.distanceTo(trade.partnerPosition);
                    if (distanceToPartner > MAX_PARTNER_DISTANCE) {
                        bb.log?.warn({ distance: distanceToPartner.toFixed(1), max: MAX_PARTNER_DISTANCE },
                            `[${this.config.roleLabel}] Trade partners too far apart`);

                        // Check retry count
                        if (bb.villageChat.hasExceededMaxRetries()) {
                            bb.log?.warn(`[${this.config.roleLabel}] Max retries exceeded, cancelling trade`);
                            bb.villageChat.cancelTrade();
                            return 'failure';
                        }

                        // Request retry with new convergence attempt
                        bb.log?.info(`[${this.config.roleLabel}] Requesting trade retry (proximity)`);
                        bb.villageChat.sendTradeRetry();
                        return 'running';
                    }
                }

                // Partner ready - giver drops items
                if (trade.role === 'giver') {
                    bb.villageChat.setTradeStatus('dropping');
                }
                return 'running';
            }

            case 'dropping': {
                // Giver: drop items
                bb.lastAction = 'trade_dropping';

                // Face the partner before dropping items (so items go towards them)
                if (trade.partnerPosition) {
                    try {
                        await bot.lookAt(trade.partnerPosition.offset(0, 1.6, 0)); // Look at partner's head level
                        bb.log?.debug({ partnerPos: trade.partnerPosition.floored().toString() },
                            `[${this.config.roleLabel}] Facing trade partner`);
                        await sleep(200); // Brief pause after turning
                    } catch (error) {
                        bb.log?.debug({ err: error }, `[${this.config.roleLabel}] Failed to face partner, continuing anyway`);
                    }
                } else {
                    // No partner position known - face the meeting point
                    const meetingPoint = trade.meetingPoint || bot.entity.position;
                    if (bot.entity.position.distanceTo(meetingPoint) > 0.5) {
                        try {
                            await bot.lookAt(meetingPoint.offset(0, 1, 0));
                            await sleep(200);
                        } catch {
                            // Continue anyway
                        }
                    }
                }

                // Get list of items to drop - use trade.items if available, else single item
                const itemsToDrop = trade.items ?? [{ name: trade.item, count: trade.quantity }];

                // Record total inventory before dropping for verification
                const totalBeforeDrop = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

                // Drop all items at once
                let totalDropped = 0;
                const droppedItems: string[] = [];

                for (const itemToDrop of itemsToDrop) {
                    // Find matching inventory slot
                    const itemSlot = bot.inventory.items().find(i => i.name === itemToDrop.name);
                    if (!itemSlot) {
                        bb.log?.debug({ item: itemToDrop.name },
                            `[${this.config.roleLabel}] Item not found in inventory, skipping`);
                        continue;
                    }

                    // Drop the specified count (or whatever we have)
                    const dropCount = Math.min(itemSlot.count, itemToDrop.count);
                    try {
                        await bot.toss(itemSlot.type, itemSlot.metadata, dropCount);
                        totalDropped += dropCount;
                        droppedItems.push(`${dropCount}x ${itemToDrop.name}`);
                    } catch (error) {
                        bb.log?.warn({ err: error, item: itemToDrop.name },
                            `[${this.config.roleLabel}] Failed to drop item`);
                    }
                }

                if (totalDropped === 0) {
                    bb.log?.warn({ items: itemsToDrop.map(i => i.name) },
                        `[${this.config.roleLabel}] No items dropped - cancelling trade`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                bb.log?.info({ dropped: droppedItems.join(', ') },
                    `[${this.config.roleLabel}] Dropped all trade items`);

                // Wait for toss to complete
                await sleep(300);

                // Verify items left inventory
                const totalAfterDrop = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
                const actualDropped = totalBeforeDrop - totalAfterDrop;
                bb.villageChat.setGiverDroppedCount(actualDropped);

                if (actualDropped <= 0) {
                    bb.log?.warn({ totalBefore: totalBeforeDrop, totalAfter: totalAfterDrop },
                        `[${this.config.roleLabel}] Items did not leave inventory - may have picked them up`);

                    // Check retry count
                    if (bb.villageChat.hasExceededMaxRetries()) {
                        bb.log?.warn(`[${this.config.roleLabel}] Max retries exceeded after failed drop, cancelling`);
                        bb.villageChat.cancelTrade();
                        return 'failure';
                    }

                    // Request retry
                    bb.log?.info(`[${this.config.roleLabel}] Requesting trade retry (drop verification failed)`);
                    bb.villageChat.sendTradeRetry();
                    return 'running';
                }

                bb.log?.info({ droppedCount: actualDropped },
                    `[${this.config.roleLabel}] Verified items dropped`);

                // Step back far enough to avoid accidentally picking up items
                // Step AWAY from the partner (opposite direction) to prevent picking up own items
                const meetingPoint = trade.meetingPoint || bot.entity.position;
                let stepBackDir: Vec3;

                if (trade.partnerPosition) {
                    // Step away from partner (opposite direction from partner)
                    stepBackDir = bot.entity.position.clone()
                        .subtract(trade.partnerPosition)
                        .normalize();
                } else {
                    stepBackDir = bot.entity.position.clone()
                        .subtract(meetingPoint)
                        .normalize();
                }

                // If direction is too small, pick an arbitrary direction
                if (stepBackDir.norm() < 0.1) {
                    stepBackDir = new Vec3(1, 0, 0);
                }

                const stepBackPos = bot.entity.position.clone()
                    .add(stepBackDir.scaled(STEP_BACK_DISTANCE));

                try {
                    await smartPathfinderGoto(
                        bot,
                        new GoalNear(stepBackPos.x, stepBackPos.y, stepBackPos.z, 1),
                        { timeoutMs: 5000 }
                    );
                    bb.log?.debug({ pos: stepBackPos.floored().toString() },
                        `[${this.config.roleLabel}] Stepped back from meeting point`);
                } catch {
                    // If pathfinding fails, try manual walk back
                    bb.log?.debug(`[${this.config.roleLabel}] Step back pathfinding failed, trying manual walk`);
                    bot.setControlState('back', true);
                    await sleep(1500);
                    bot.setControlState('back', false);
                }

                // Signal items dropped - status changes to 'awaiting_pickup'
                bb.villageChat.sendTradeDropped();

                // Don't complete yet - return running to let tick be called again
                bb.lastAction = 'trade_awaiting_pickup';
                return 'running';
            }

            case 'awaiting_pickup': {
                // Giver: waiting for receiver to pick up and send TRADE_DONE
                bb.lastAction = 'trade_awaiting_pickup';

                // Check if receiver already completed (they send TRADE_DONE which clears our trade state)
                if (!bb.villageChat.isInTrade()) {
                    bb.lastAction = 'trade_done';
                    bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver) - receiver confirmed`);
                    return 'success';
                }

                // Check for timeout
                const elapsed = Date.now() - trade.offerTimestamp;
                if (elapsed > TRADE_TIMEOUT) {
                    bb.log?.warn(`[${this.config.roleLabel}] Trade timeout waiting for receiver to pick up`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Keep waiting
                await sleep(1000);
                return 'running';
            }

            case 'picking_up': {
                // Receiver: pick up items
                bb.lastAction = 'trade_picking_up';

                // pickupStartCount was set when we sent WANT (beginning of trade)
                // This is the correct baseline for verification since items may auto-collect during travel
                const countBefore = trade.pickupStartCount;

                // Define meeting point and search center (used throughout)
                const meetingPoint = trade.meetingPoint || bot.entity.position;
                const searchCenter = trade.partnerPosition || meetingPoint;

                // Check if items were already auto-collected during traveling
                const currentCount = bot.inventory.items()
                    .filter(i => i.name === trade.item)
                    .reduce((sum, i) => sum + i.count, 0);

                bb.log?.debug({ countBefore, currentCount },
                    `[${this.config.roleLabel}] Checking pickup status`);

                // If items were already auto-collected during travel, skip to verification
                if (currentCount <= countBefore) {
                    // Items not yet collected - need to walk and pick up

                    // Wait for items to settle on ground
                    await sleep(PICKUP_VERIFICATION_WAIT);

                    // Find dropped items near meeting point or partner position
                    const droppedItems = Object.values(bot.entities).filter(e =>
                        e.name === 'item' &&
                        e.position &&
                        (e.position.distanceTo(meetingPoint) < 6 || e.position.distanceTo(searchCenter) < 6)
                    );

                    if (droppedItems.length === 0) {
                        // No items visible via entities - walk to drop location for auto-pickup
                        // This handles Minecraft entity visibility issues between clients
                        bb.log?.debug({
                            countBefore,
                            searchCenter: searchCenter.toString(),
                            botPosition: bot.entity.position.toString(),
                        }, `[${this.config.roleLabel}] No item entities visible, walking to drop location`);

                        // Walk to where the partner was (where items were dropped)
                        const dist = bot.entity.position.distanceTo(searchCenter);
                        if (dist > 1.5) {
                            try {
                                await smartPathfinderGoto(
                                    bot,
                                    new GoalNear(searchCenter.x, searchCenter.y, searchCenter.z, 0.5),
                                    { timeoutMs: 5000 }
                                );
                            } catch {
                                bb.log?.debug(`[${this.config.roleLabel}] Pathfinding failed`);
                            }
                        }

                        // Actively walk through the area to collect any items
                        // Look at and walk toward the drop location
                        const direction = searchCenter.minus(bot.entity.position);
                        const yaw = Math.atan2(-direction.x, -direction.z);
                        await bot.look(yaw, 0);
                        bot.setControlState('forward', true);
                        await sleep(600);
                        bot.clearControlStates();

                        // Check if inventory increased
                        const countNow = bot.inventory.items()
                            .filter(i => i.name === trade.item)
                            .reduce((sum, i) => sum + i.count, 0);

                        if (countNow <= countBefore) {
                            // Still no items - check for timeout
                            const elapsed = Date.now() - trade.offerTimestamp;
                            if (elapsed > TRADE_TIMEOUT) {
                                bb.log?.warn(`[${this.config.roleLabel}] Trade timeout - no items received`);
                                if (!bb.villageChat.hasExceededMaxRetries()) {
                                    bb.log?.info(`[${this.config.roleLabel}] Requesting trade retry (no items found)`);
                                    bb.villageChat.sendTradeRetry();
                                    return 'running';
                                }
                                bb.villageChat.cancelTrade();
                                return 'failure';
                            }
                            return 'running';
                        }
                        bb.log?.info({ received: countNow - countBefore },
                            `[${this.config.roleLabel}] Items auto-collected via proximity`);
                    } else {
                        // Items detected via entities - collect them directly
                        bb.log?.debug({ itemCount: droppedItems.length },
                            `[${this.config.roleLabel}] Found dropped items via entities, collecting`);

                        for (const drop of droppedItems) {
                            if (!drop.position) continue;
                            const dist = bot.entity.position.distanceTo(drop.position);
                            if (dist > 1.5) {
                                try {
                                    await smartPathfinderGoto(
                                        bot,
                                        new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1),
                                        { timeoutMs: 5000 }
                                    );
                                } catch {
                                    // Continue trying other items
                                }
                            }
                            // Actively walk into the item to collect it (don't just stand nearby)
                            const collected = await walkTowardAndCollect(bot, drop, 800);
                            if (collected) {
                                bb.log?.debug({ dropId: drop.id }, `[${this.config.roleLabel}] Collected item via walk-into`);
                            }
                        }
                        await sleep(300);
                    }
                } else {
                    bb.log?.info({ received: currentCount - countBefore },
                        `[${this.config.roleLabel}] Items were auto-collected during travel`);
                }

                // Verify we received the correct item
                const countAfter = bot.inventory.items()
                    .filter(i => i.name === trade.item)
                    .reduce((sum, i) => sum + i.count, 0);

                const actualReceived = countAfter - countBefore;

                if (actualReceived <= 0) {
                    bb.log?.warn({
                        item: trade.item,
                        countBefore,
                        countAfter,
                        expectedQty: trade.quantity,
                        giverDropped: trade.giverDroppedCount
                    }, `[${this.config.roleLabel}] Trade verification failed - did not receive expected item`);

                    // Check if items still on ground
                    const remainingItems = Object.values(bot.entities).filter(e =>
                        e.name === 'item' &&
                        e.position &&
                        (e.position.distanceTo(meetingPoint) < 6 || e.position.distanceTo(searchCenter) < 6)
                    );

                    if (remainingItems.length > 0) {
                        bb.log?.debug({ remaining: remainingItems.length },
                            `[${this.config.roleLabel}] Still items on ground, retrying pickup`);
                        return 'running';
                    }

                    // No items on ground and we didn't receive anything - trade failed
                    if (!bb.villageChat.hasExceededMaxRetries()) {
                        bb.log?.info(`[${this.config.roleLabel}] Requesting trade retry (pickup verification failed)`);
                        bb.villageChat.sendTradeRetry();
                        return 'running';
                    }

                    bb.log?.warn(`[${this.config.roleLabel}] Trade failed after max retries, cancelling`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                bb.log?.info({
                    item: trade.item,
                    received: actualReceived,
                    expected: trade.quantity,
                    giverDropped: trade.giverDroppedCount
                }, `[${this.config.roleLabel}] Trade verification successful`);

                // Signal done
                bb.villageChat.sendTradeDone();
                bb.lastAction = 'trade_done';
                bb.log?.info(`[${this.config.roleLabel}] Trade complete (receiver)`);
                return 'success';
            }

            default:
                return 'failure';
        }
    }
}
