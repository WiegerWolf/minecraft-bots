import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../PathfindingUtils';
import type { VillageChat } from '../VillageChat';
import type { Logger } from '../logger';

const { GoalLookAtBlock } = goals;

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * Minimal blackboard interface required by BaseDepositItems.
 */
export interface DepositItemsBlackboard {
    inventoryFull: boolean;
    nearbyChests: Block[];
    lastAction: string;
    villageChat?: VillageChat | null;
    log?: Logger | null;
}

/**
 * Item filter for deposits - matches item names containing any of these patterns.
 */
export interface DepositFilter {
    /** Patterns to match against item names (e.g., 'wheat', '_log') */
    patterns: string[];
    /** Items to keep - map of exact item name to amount to keep */
    keepAmounts?: Record<string, number>;
}

/**
 * Configuration options for deposit behavior.
 */
export interface DepositItemsConfig {
    /** Item filter configuration */
    depositFilter: DepositFilter;
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** lastAction value when depositing (default: 'deposit') */
    lastActionDeposit?: string;
    /** Sleep duration after pathfinding in ms (default: 200) */
    postPathfindSleepMs?: number;
    /** Sleep duration between deposits in ms (default: 50) */
    betweenDepositSleepMs?: number;
    /** Announce deposit type (e.g., 'logs', 'materials') or null to skip */
    announceType?: string | null;
    /** Pathfinding timeout in ms (default: 15000) */
    pathfindingTimeoutMs?: number;
}

const DEFAULT_CONFIG: Omit<Required<DepositItemsConfig>, 'depositFilter'> = {
    roleLabel: 'Bot',
    lastActionDeposit: 'deposit',
    postPathfindSleepMs: 200,
    betweenDepositSleepMs: 50,
    announceType: null,
    pathfindingTimeoutMs: 15000,
};

/**
 * Base class for depositing items to chests.
 *
 * Handles:
 * - Finding chest (via abstract method)
 * - Navigating to chest
 * - Opening container
 * - Depositing items matching filter
 * - Respecting keep amounts
 * - Optional chat announcements
 *
 * Usage:
 * ```typescript
 * export class DepositItems extends BaseDepositItems<MyBlackboard> {
 *     constructor() {
 *         super({
 *             depositFilter: {
 *                 patterns: ['wheat', 'carrot', 'potato'],
 *                 keepAmounts: { 'wheat_seeds': 32 }
 *             },
 *             roleLabel: 'Farmer'
 *         });
 *     }
 *
 *     protected shouldDeposit(bb: MyBlackboard): boolean {
 *         return bb.inventoryFull || bb.produceCount >= 16;
 *     }
 *
 *     protected findChest(bot: Bot, bb: MyBlackboard): Vec3 | null {
 *         return bb.farmChest || bb.nearbyChests[0]?.position || null;
 *     }
 * }
 * ```
 */
export abstract class BaseDepositItems<TBlackboard extends DepositItemsBlackboard> {
    readonly name = 'DepositItems';
    protected config: Required<DepositItemsConfig>;

    constructor(config: DepositItemsConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config } as Required<DepositItemsConfig>;
    }

    /**
     * Determine if the bot should deposit items.
     * Subclasses implement role-specific threshold logic.
     */
    protected abstract shouldDeposit(bb: TBlackboard): boolean;

    /**
     * Find the chest position to deposit to.
     * Returns null if no chest is available.
     */
    protected abstract findChest(bot: Bot, bb: TBlackboard): Vec3 | null;

    /**
     * Called when the chest at the expected position is missing.
     * Subclasses can override to clear cached chest positions.
     */
    protected onChestMissing(bb: TBlackboard, chestPos: Vec3): void {
        // Default: no-op. Subclasses can override.
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        if (!this.shouldDeposit(bb)) {
            return 'failure';
        }

        const chestPos = this.findChest(bot, bb);
        if (!chestPos) {
            return 'failure';
        }

        const chestBlock = bot.blockAt(chestPos);
        if (!chestBlock || !['chest', 'barrel'].includes(chestBlock.name)) {
            bb.log?.debug(`[${this.config.roleLabel}] Chest missing at ${chestPos}`);
            this.onChestMissing(bb, chestPos);
            return 'failure';
        }

        bb.log?.debug(`[${this.config.roleLabel}] Depositing items at chest ${chestPos}`);
        bb.lastAction = this.config.lastActionDeposit;

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalLookAtBlock(chestPos, bot.world, { reach: 4 }),
                { timeoutMs: this.config.pathfindingTimeoutMs }
            );

            if (!result.success) {
                bb.log?.debug(`[${this.config.roleLabel}] Failed to reach deposit chest: ${result.failureReason}`);
                return 'failure';
            }

            bot.pathfinder.stop();
            await sleep(this.config.postPathfindSleepMs);

            const container = await bot.openContainer(chestBlock);

            let totalDeposited = 0;

            // Get items to deposit
            const itemsToDeposit = this.getItemsToDeposit(bot, bb);

            for (const { item, amount } of itemsToDeposit) {
                try {
                    await container.deposit(item.type, null, amount);
                    totalDeposited += amount;
                    if (this.config.betweenDepositSleepMs > 0) {
                        await sleep(this.config.betweenDepositSleepMs);
                    }
                } catch {
                    // Chest might be full, continue with other items
                    bb.log?.debug(`[${this.config.roleLabel}] Failed to deposit ${item.name}, chest may be full`);
                }
            }

            container.close();

            if (totalDeposited > 0) {
                bb.log?.debug(`[${this.config.roleLabel}] Deposited ${totalDeposited} items`);

                // Announce if configured
                if (this.config.announceType && bb.villageChat) {
                    bb.villageChat.announceDeposit(this.config.announceType, totalDeposited);
                }
            }

            return 'success';
        } catch (err) {
            bb.log?.debug(`[${this.config.roleLabel}] Failed to deposit: ${err}`);
            return 'failure';
        }
    }

    /**
     * Get items to deposit with amounts (respecting keep amounts).
     */
    private getItemsToDeposit(bot: Bot, bb: TBlackboard): Array<{ item: any; amount: number }> {
        const result: Array<{ item: any; amount: number }> = [];
        const { patterns, keepAmounts = {} } = this.config.depositFilter;

        // Group items by name to handle keep amounts correctly
        const itemsByName = new Map<string, any[]>();
        for (const item of bot.inventory.items()) {
            const matchesPattern = patterns.some(p => item.name.includes(p));
            if (matchesPattern) {
                const items = itemsByName.get(item.name) || [];
                items.push(item);
                itemsByName.set(item.name, items);
            }
        }

        // Calculate deposit amounts respecting keep amounts
        for (const [name, items] of itemsByName) {
            const keepAmount = keepAmounts[name] ?? 0;
            const totalCount = items.reduce((sum, i) => sum + i.count, 0);
            let toDeposit = totalCount - keepAmount;

            if (toDeposit <= 0) continue;

            // Distribute deposit across item stacks
            for (const item of items) {
                if (toDeposit <= 0) break;
                const amount = Math.min(item.count, toDeposit);
                result.push({ item, amount });
                toDeposit -= amount;
            }
        }

        return result;
    }
}
