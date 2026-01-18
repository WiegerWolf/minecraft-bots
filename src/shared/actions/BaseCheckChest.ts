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
 * Minimal blackboard interface required by BaseCheckChest.
 */
export interface CheckChestBlackboard {
    nearbyChests: Block[];
    lastAction: string;
    villageChat?: VillageChat | null;
    log?: Logger | null;
}

/**
 * Withdrawal priority item configuration.
 */
export interface WithdrawalItem {
    /** Pattern to match in item name (e.g., '_log', '_planks', 'stick') */
    pattern: string;
    /** Maximum amount to withdraw */
    maxAmount: number;
    /** If true, only withdraw if previous priority items weren't found */
    onlyIfPreviousEmpty?: boolean;
}

/**
 * Configuration options for check chest behavior.
 */
export interface CheckChestConfig {
    /** Items to withdraw in priority order */
    withdrawalPriorities: WithdrawalItem[];
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** lastAction value (default: 'check_chest') */
    lastActionCheck?: string;
    /** Sleep duration after pathfinding in ms (default: 200) */
    postPathfindSleepMs?: number;
    /** Sleep duration after opening chest in ms (default: 100) */
    postOpenSleepMs?: number;
    /** Sleep duration between withdrawals in ms (default: 100) */
    betweenWithdrawSleepMs?: number;
    /** Pathfinding timeout in ms (default: 15000) */
    pathfindingTimeoutMs?: number;
}

const DEFAULT_CONFIG: Omit<Required<CheckChestConfig>, 'withdrawalPriorities'> = {
    roleLabel: 'Bot',
    lastActionCheck: 'check_chest',
    postPathfindSleepMs: 200,
    postOpenSleepMs: 100,
    betweenWithdrawSleepMs: 100,
    pathfindingTimeoutMs: 15000,
};

/**
 * Base class for checking chests and withdrawing materials.
 *
 * Handles:
 * - Finding chest (via abstract method)
 * - Navigating to chest
 * - Opening container
 * - Withdrawing items in priority order
 * - Tracking withdrawal amounts
 *
 * Usage:
 * ```typescript
 * export class CheckSharedChest extends BaseCheckChest<MyBlackboard> {
 *     constructor() {
 *         super({
 *             withdrawalPriorities: [
 *                 { pattern: '_log', maxAmount: 4 },
 *                 { pattern: '_planks', maxAmount: 8, onlyIfPreviousEmpty: true },
 *             ],
 *             roleLabel: 'Farmer'
 *         });
 *     }
 *
 *     protected hasSufficientMaterials(bb: MyBlackboard): boolean {
 *         return bb.logCount >= 2;
 *     }
 *
 *     protected findChest(bot: Bot, bb: MyBlackboard): Vec3 | null {
 *         return bb.sharedChest || bb.nearbyChests[0]?.position || null;
 *     }
 * }
 * ```
 */
export abstract class BaseCheckChest<TBlackboard extends CheckChestBlackboard> {
    readonly name = 'CheckSharedChest';
    protected config: Required<CheckChestConfig>;

    constructor(config: CheckChestConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config } as Required<CheckChestConfig>;
    }

    /**
     * Check if the bot already has sufficient materials.
     * Return true to skip checking the chest.
     */
    protected abstract hasSufficientMaterials(bb: TBlackboard): boolean;

    /**
     * Find the chest position to check.
     * Returns null if no chest is available.
     */
    protected abstract findChest(bot: Bot, bb: TBlackboard): Vec3 | null;

    /**
     * Called after successful withdrawal.
     * Subclasses can override to update blackboard counts or announce.
     */
    protected onWithdrawalComplete(
        bot: Bot,
        bb: TBlackboard,
        withdrawnByPattern: Map<string, number>
    ): void {
        // Default: no-op. Subclasses can override.
    }

    /**
     * Called when chest had no useful materials.
     * Subclasses can override to request materials.
     */
    protected onChestEmpty(bot: Bot, bb: TBlackboard): void {
        // Default: no-op. Subclasses can override.
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        // Already have sufficient materials
        if (this.hasSufficientMaterials(bb)) {
            return 'failure';
        }

        const chestPos = this.findChest(bot, bb);
        if (!chestPos) {
            bb.log?.debug(`[${this.config.roleLabel}] No chest available`);
            return 'failure';
        }

        const chestBlock = bot.blockAt(chestPos);
        if (!chestBlock || !['chest', 'barrel'].includes(chestBlock.name)) {
            bb.log?.debug(`[${this.config.roleLabel}] Chest not found at ${chestPos}`);
            return 'failure';
        }

        bb.lastAction = this.config.lastActionCheck;
        bb.log?.debug(`[${this.config.roleLabel}] Checking chest for materials at ${chestPos}`);

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalLookAtBlock(chestPos, bot.world, { reach: 4 }),
                { timeoutMs: this.config.pathfindingTimeoutMs }
            );

            if (!result.success) {
                bb.log?.debug(`[${this.config.roleLabel}] Failed to reach chest: ${result.failureReason}`);
                return 'failure';
            }

            await sleep(this.config.postPathfindSleepMs);

            // Re-check chest exists after pathfinding
            const currentChestBlock = bot.blockAt(chestPos);
            if (!currentChestBlock || !['chest', 'barrel'].includes(currentChestBlock.name)) {
                bb.log?.debug(`[${this.config.roleLabel}] Chest at ${chestPos} disappeared`);
                return 'failure';
            }

            const container = await bot.openContainer(currentChestBlock);
            await sleep(this.config.postOpenSleepMs);

            const chestItems = container.containerItems();
            const withdrawnByPattern = new Map<string, number>();
            let totalWithdrawn = 0;
            let previousEmpty = false;

            // Process withdrawal priorities
            for (const priority of this.config.withdrawalPriorities) {
                // Skip if this priority requires previous to be empty and it wasn't
                if (priority.onlyIfPreviousEmpty && !previousEmpty && totalWithdrawn > 0) {
                    continue;
                }

                const alreadyWithdrawn = withdrawnByPattern.get(priority.pattern) ?? 0;
                const remaining = priority.maxAmount - alreadyWithdrawn;
                if (remaining <= 0) continue;

                let withdrawnThisPriority = 0;

                for (const item of chestItems) {
                    if (!item.name.includes(priority.pattern)) continue;
                    if (withdrawnThisPriority >= remaining) break;

                    const toWithdraw = Math.min(item.count, remaining - withdrawnThisPriority);
                    try {
                        await container.withdraw(item.type, null, toWithdraw);
                        withdrawnThisPriority += toWithdraw;
                        totalWithdrawn += toWithdraw;
                        bb.log?.debug(`[${this.config.roleLabel}] Withdrew ${toWithdraw} ${item.name}`);
                        await sleep(this.config.betweenWithdrawSleepMs);
                    } catch (err) {
                        bb.log?.debug(`[${this.config.roleLabel}] Failed to withdraw ${item.name}: ${err}`);
                    }
                }

                withdrawnByPattern.set(
                    priority.pattern,
                    alreadyWithdrawn + withdrawnThisPriority
                );

                // Track if this priority found nothing
                previousEmpty = withdrawnThisPriority === 0;
            }

            container.close();

            if (totalWithdrawn > 0) {
                this.onWithdrawalComplete(bot, bb, withdrawnByPattern);
                return 'success';
            } else {
                this.onChestEmpty(bot, bb);
                return 'failure';
            }
        } catch (error) {
            bb.log?.warn({ err: error }, `[${this.config.roleLabel}] Error checking chest`);
            return 'failure';
        }
    }
}
