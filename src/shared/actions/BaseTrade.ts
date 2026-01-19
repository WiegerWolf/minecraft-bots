import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../PathfindingUtils';
import type { Logger } from '../logger';
import type { VillageChat, TradeOffer, ActiveTrade, TradeStatus } from '../VillageChat';
import type { InventoryItem, RoleName } from '../ItemCategories';
import { isWantedByRole, getItemCount, getTradeableItems } from '../ItemCategories';

const { GoalNear } = goals;

export type BehaviorStatus = 'success' | 'failure' | 'running';

// Trade timing constants
const OFFER_COLLECTION_WINDOW = 5000;      // 5 seconds to collect WANT responses
const OFFER_COOLDOWN = 30000;               // 30 seconds between offers
const TRADE_TIMEOUT = 120000;               // 2 minutes max for entire trade
const MIN_TRADEABLE_ITEMS = 4;              // Minimum items to trigger an offer
const MEETING_POINT_RADIUS = 2;             // How close to get to meeting point
const STEP_BACK_DISTANCE = 4;               // Distance to step back after dropping (must be > pickup range of 2)
const GIVER_WAIT_AFTER_DROP = 3000;         // Time giver waits after dropping before considering done
const PICKUP_VERIFICATION_WAIT = 1000;      // Time to wait for items to settle before pickup

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
     */
    canOffer(bb: TBlackboard): boolean {
        if (!bb.villageChat) return false;
        if (bb.villageChat.isInTrade()) return false;

        const now = Date.now();
        if (now - bb.lastOfferTime < this.config.offerCooldown) return false;

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
                return 'running';
            }

            // Time's up - select the neediest bot
            const neediest = bb.villageChat.selectNeediestBot();
            if (!neediest) {
                bb.log?.debug(`[${this.config.roleLabel}] No takers for trade offer`);
                bb.villageChat.clearActiveTrade();
                return 'failure';
            }

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
        if (bb.villageCenter) {
            return bb.villageCenter.offset(3, 0, 3);
        }
        if (bb.spawnPosition) {
            return bb.spawnPosition.offset(3, 0, 3);
        }
        return bot.entity.position.offset(3, 0, 0);
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

            // Signal items dropped
            bb.villageChat.sendTradeDropped();

            // Wait a bit for receiver to pick up - giver should NOT send TRADE_DONE immediately
            // The receiver will send TRADE_DONE when they've picked up the items
            // We just wait here - trade will complete when we receive receiver's TRADE_DONE
            await sleep(GIVER_WAIT_AFTER_DROP);

            // Check if receiver already completed (they send TRADE_DONE which clears our trade state)
            if (!bb.villageChat.isInTrade()) {
                bb.lastAction = 'trade_done';
                bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver) - receiver confirmed`);
                return 'success';
            }

            // If receiver hasn't confirmed yet, send our done signal
            // This handles the case where receiver already picked up and we missed their signal
            bb.villageChat.sendTradeDone();
            bb.lastAction = 'trade_done';
            bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver)`);

            return 'success';
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
                try {
                    await smartPathfinderGoto(
                        bot,
                        new GoalNear(trade.meetingPoint.x, trade.meetingPoint.y, trade.meetingPoint.z, MEETING_POINT_RADIUS),
                        { timeoutMs: 30000 }
                    );
                    bb.villageChat.sendTradeReady();
                } catch (error) {
                    const msg = error instanceof Error ? error.message : 'unknown';
                    if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                        bb.log?.debug({ err: msg }, `[${this.config.roleLabel}] Travel error`);
                    }
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

                if (!trade.partnerReady) {
                    return 'running';
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

                // Find the item to drop - must match trade item EXACTLY
                const itemSlot = bot.inventory.items().find(i => i.name === trade.item);
                if (!itemSlot) {
                    bb.log?.warn({ item: trade.item, inventory: bot.inventory.items().map(i => i.name) },
                        `[${this.config.roleLabel}] Trade item not found in inventory - cancelling`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Defensive check: verify item name matches exactly
                if (itemSlot.name !== trade.item) {
                    bb.log?.warn({ expected: trade.item, found: itemSlot.name },
                        `[${this.config.roleLabel}] Item mismatch - cancelling trade`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Drop ONLY the offered quantity, not the entire stack
                const dropCount = Math.min(itemSlot.count, trade.quantity);
                try {
                    await bot.toss(itemSlot.type, itemSlot.metadata, dropCount);
                    bb.log?.info({ item: trade.item, qty: dropCount, hadInStack: itemSlot.count },
                        `[${this.config.roleLabel}] Dropped trade items`);
                } catch (error) {
                    bb.log?.warn({ err: error, item: trade.item },
                        `[${this.config.roleLabel}] Drop failed`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Step back far enough to avoid accidentally picking up items
                const meetingPoint = trade.meetingPoint || bot.entity.position;
                const stepBackDir = bot.entity.position.clone()
                    .subtract(meetingPoint)
                    .normalize();
                // If at meeting point, pick an arbitrary direction
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
                    // If pathfinding fails, try manual walk back
                    bb.log?.debug(`[${this.config.roleLabel}] Step back pathfinding failed, trying manual walk`);
                    bot.setControlState('back', true);
                    await sleep(1000);
                    bot.setControlState('back', false);
                }

                // Signal items dropped
                bb.villageChat.sendTradeDropped();

                // Wait for receiver to pick up before completing
                await sleep(GIVER_WAIT_AFTER_DROP);

                // Check if receiver already completed
                if (!bb.villageChat.isInTrade()) {
                    bb.lastAction = 'trade_done';
                    bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver) - receiver confirmed`);
                    return 'success';
                }

                // Send our done signal
                bb.villageChat.sendTradeDone();
                bb.lastAction = 'trade_done';
                bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver)`);
                return 'success';
            }

            case 'picking_up': {
                // Receiver: pick up items
                bb.lastAction = 'trade_picking_up';

                // Record inventory BEFORE pickup to verify we actually received items
                const countBefore = bot.inventory.items()
                    .filter(i => i.name === trade.item)
                    .reduce((sum, i) => sum + i.count, 0);

                // Wait for items to settle on ground
                await sleep(PICKUP_VERIFICATION_WAIT);

                // Find dropped items near meeting point
                const meetingPoint = trade.meetingPoint || bot.entity.position;
                const droppedItems = Object.values(bot.entities).filter(e =>
                    e.name === 'item' &&
                    e.position &&
                    e.position.distanceTo(meetingPoint) < 5
                );

                if (droppedItems.length === 0) {
                    bb.log?.debug(`[${this.config.roleLabel}] No dropped items found yet`);
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

                // Move to collect items
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
                            // Continue trying other items
                        }
                    }
                    await sleep(300);
                }

                // Wait for items to enter inventory
                await sleep(500);

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
                        expectedQty: trade.quantity
                    }, `[${this.config.roleLabel}] Trade verification failed - did not receive expected item`);

                    // Check if items still on ground
                    const remainingItems = Object.values(bot.entities).filter(e =>
                        e.name === 'item' &&
                        e.position &&
                        e.position.distanceTo(meetingPoint) < 5
                    );

                    if (remainingItems.length > 0) {
                        bb.log?.debug(`[${this.config.roleLabel}] Still items on ground, retrying`);
                        return 'running';
                    }

                    bb.log?.warn(`[${this.config.roleLabel}] Trade may have failed, completing anyway`);
                } else {
                    bb.log?.info({
                        item: trade.item,
                        received: actualReceived,
                        expected: trade.quantity
                    }, `[${this.config.roleLabel}] Trade verification successful`);
                }

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
