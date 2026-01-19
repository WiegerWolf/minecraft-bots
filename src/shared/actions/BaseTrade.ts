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
const STEP_BACK_DISTANCE = 3;               // Distance to step back after dropping

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

            // Find the items to drop
            const itemSlot = bot.inventory.items().find(i => i.name === trade.item);
            if (!itemSlot) {
                bb.log?.warn({ item: trade.item }, `[${this.config.roleLabel}] Trade item not found in inventory`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            // Drop the items
            const dropCount = Math.min(itemSlot.count, trade.quantity);
            try {
                await bot.tossStack(itemSlot);
                bb.log?.info({ item: trade.item, qty: dropCount },
                    `[${this.config.roleLabel}] Dropped trade items`);
            } catch (error) {
                bb.log?.warn({ err: error }, `[${this.config.roleLabel}] Failed to drop items`);
                bb.villageChat.cancelTrade();
                return 'failure';
            }

            // Step back
            const stepBackDir = bot.entity.position.clone()
                .subtract(trade.meetingPoint || bot.entity.position)
                .normalize();
            const stepBackPos = bot.entity.position.clone()
                .add(stepBackDir.scaled(STEP_BACK_DISTANCE));

            try {
                await smartPathfinderGoto(
                    bot,
                    new GoalNear(stepBackPos.x, stepBackPos.y, stepBackPos.z, 1),
                    { timeoutMs: 5000 }
                );
            } catch {
                // Ignore - we can continue even if step back fails
            }

            // Signal items dropped
            bb.villageChat.sendTradeDropped();
            await sleep(500);

            // Signal done
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

            // Wait a moment for items to be on ground
            await sleep(500);

            // Find the dropped items
            const droppedItems = Object.values(bot.entities).filter(e =>
                e.name === 'item' &&
                e.position &&
                e.position.distanceTo(trade.meetingPoint || bot.entity.position) < 5
            );

            if (droppedItems.length === 0) {
                bb.log?.debug(`[${this.config.roleLabel}] No dropped items found, waiting...`);
                await sleep(1000);
                return 'running';
            }

            // Move to collect
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
                        // Ignore
                    }
                }
                await sleep(300);
            }

            // Signal done
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

                const itemSlot = bot.inventory.items().find(i => i.name === trade.item);
                if (!itemSlot) {
                    bb.log?.warn({ item: trade.item }, `[${this.config.roleLabel}] Item not found`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                try {
                    await bot.tossStack(itemSlot);
                    bb.log?.info({ item: trade.item, qty: itemSlot.count },
                        `[${this.config.roleLabel}] Dropped trade items`);
                } catch (error) {
                    bb.log?.warn({ err: error }, `[${this.config.roleLabel}] Drop failed`);
                    bb.villageChat.cancelTrade();
                    return 'failure';
                }

                // Step back
                const stepBackDir = bot.entity.position.clone()
                    .subtract(trade.meetingPoint || bot.entity.position)
                    .normalize();
                const stepBackPos = bot.entity.position.clone()
                    .add(stepBackDir.scaled(STEP_BACK_DISTANCE));

                try {
                    await smartPathfinderGoto(
                        bot,
                        new GoalNear(stepBackPos.x, stepBackPos.y, stepBackPos.z, 1),
                        { timeoutMs: 5000 }
                    );
                } catch {
                    // Continue even if step back fails
                }

                bb.villageChat.sendTradeDropped();
                await sleep(500);
                bb.villageChat.sendTradeDone();

                bb.lastAction = 'trade_done';
                bb.log?.info(`[${this.config.roleLabel}] Trade complete (giver)`);
                return 'success';
            }

            case 'picking_up': {
                // Receiver: pick up items
                bb.lastAction = 'trade_picking_up';
                await sleep(500);

                const droppedItems = Object.values(bot.entities).filter(e =>
                    e.name === 'item' &&
                    e.position &&
                    e.position.distanceTo(trade.meetingPoint || bot.entity.position) < 5
                );

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
                            // Ignore
                        }
                    }
                    await sleep(300);
                }

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
