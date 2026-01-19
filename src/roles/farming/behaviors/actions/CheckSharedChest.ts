import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import type { FarmingBlackboard } from '../../Blackboard';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

const { GoalLookAtBlock } = goals;

type BehaviorStatus = 'success' | 'failure' | 'running';

// Cooldown between material requests
const REQUEST_COOLDOWN_MS = 30000;

/**
 * CheckSharedChest - Check shared chest for materials and withdraw them.
 *
 * Farmer-specific behavior:
 * - Only checks when needs tools and doesn't have enough materials
 * - Withdraws logs (priority 1), planks (priority 2), sticks (priority 3)
 * - Uses village chat shared chest or finds chest near farm center
 * - If chest is empty, requests materials from lumberjack and returns 'running'
 *
 * This avoids the problem where CheckSharedChest fails on empty chest,
 * putting ObtainTools on cooldown while the farmer wanders off.
 */
export class CheckSharedChest {
    readonly name = 'CheckSharedChest';
    private lastRequestTime = 0;

    private hasSufficientMaterials(bb: FarmingBlackboard): boolean {
        // Skip if we don't need tools
        if (!bb.needsTools) return true;

        // Check if we have enough materials to craft a hoe:
        // Need: 2 planks (head) + 2 sticks (handle)
        // Or: 2 logs (= 8 planks = enough for sticks + hoe)
        return (
            (bb.stickCount >= 2 && bb.plankCount >= 2) ||
            bb.logCount >= 2
        );
    }

    private findChest(bot: Bot, bb: FarmingBlackboard): Vec3 | null {
        // ONLY use shared chest announced by lumberjack (who placed it)
        // Never adopt random nearby chests - they could be pregenerated
        // dungeon/mineshaft chests that are unreachable or underground
        const sharedChest = bb.villageChat?.getSharedChest();
        if (sharedChest) {
            // Verify the chest still exists
            const block = bot.blockAt(sharedChest);
            if (block && ['chest', 'barrel'].includes(block.name)) {
                return sharedChest;
            }
            bb.log?.debug(`[Farmer] Shared chest at ${sharedChest} no longer exists`);
        }

        // No shared chest available - must wait for lumberjack to place one
        return null;
    }

    /**
     * Request materials via need broadcast if not already requested recently.
     * Returns true if a new request was made or one is pending.
     */
    private requestMaterialsIfNeeded(bb: FarmingBlackboard): boolean {
        if (!bb.villageChat) return false;

        const now = Date.now();

        // Check if we already have a pending need
        if (bb.villageChat.hasPendingNeedFor('log')) {
            bb.lastAction = 'waiting_for_materials';
            bb.log?.debug('[Farmer] Already have pending log need');
            return true;
        }

        // Rate limit requests
        if (now - this.lastRequestTime < REQUEST_COOLDOWN_MS) {
            bb.lastAction = 'waiting_for_materials';
            return true;
        }

        // Broadcast new need
        this.lastRequestTime = now;
        bb.lastAction = 'broadcast_need';
        bb.log?.info('[Farmer] Chest empty, broadcasting need for logs');
        bb.villageChat.broadcastNeed('log');
        return true;
    }

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Already have sufficient materials
        if (this.hasSufficientMaterials(bb)) {
            return 'failure';
        }

        const chestPos = this.findChest(bot, bb);
        if (!chestPos) {
            bb.log?.debug('[Farmer] No chest available');
            // No chest - request materials and return 'running' to wait
            if (this.requestMaterialsIfNeeded(bb)) {
                return 'running';
            }
            return 'failure';
        }

        const chestBlock = bot.blockAt(chestPos);
        if (!chestBlock || !['chest', 'barrel'].includes(chestBlock.name)) {
            bb.log?.debug(`[Farmer] Chest not found at ${chestPos}`);
            return 'failure';
        }

        bb.lastAction = 'check_shared_chest';
        bb.log?.debug(`[Farmer] Checking chest for materials at ${chestPos}`);

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalLookAtBlock(chestPos, bot.world, { reach: 4 }),
                { timeoutMs: 15000 }
            );

            if (!result.success) {
                bb.log?.debug(`[Farmer] Failed to reach chest: ${result.failureReason}`);
                return 'failure';
            }

            await sleep(200);

            // Re-check chest exists after pathfinding
            const currentChestBlock = bot.blockAt(chestPos);
            if (!currentChestBlock || !['chest', 'barrel'].includes(currentChestBlock.name)) {
                bb.log?.debug(`[Farmer] Chest at ${chestPos} disappeared`);
                return 'failure';
            }

            const container = await bot.openContainer(currentChestBlock);
            await sleep(100);

            const chestItems = container.containerItems();
            let totalWithdrawn = 0;

            // Withdrawal priorities: logs first, then planks if no logs, then sticks
            const priorities = [
                { pattern: '_log', maxAmount: 4, onlyIfPreviousEmpty: false },
                { pattern: '_planks', maxAmount: 8, onlyIfPreviousEmpty: true },
                { pattern: 'stick', maxAmount: 8, onlyIfPreviousEmpty: false },
            ];

            let previousEmpty = false;

            for (const priority of priorities) {
                if (priority.onlyIfPreviousEmpty && !previousEmpty && totalWithdrawn > 0) {
                    continue;
                }

                let withdrawnThisPriority = 0;
                const remaining = priority.maxAmount;

                for (const item of chestItems) {
                    if (!item.name.includes(priority.pattern)) continue;
                    if (withdrawnThisPriority >= remaining) break;

                    const toWithdraw = Math.min(item.count, remaining - withdrawnThisPriority);
                    try {
                        await container.withdraw(item.type, null, toWithdraw);
                        withdrawnThisPriority += toWithdraw;
                        totalWithdrawn += toWithdraw;
                        bb.log?.debug(`[Farmer] Withdrew ${toWithdraw} ${item.name}`);
                        await sleep(100);
                    } catch (err) {
                        bb.log?.debug(`[Farmer] Failed to withdraw ${item.name}: ${err}`);
                    }
                }

                previousEmpty = withdrawnThisPriority === 0;
            }

            container.close();

            if (totalWithdrawn > 0) {
                bb.log?.info(`[Farmer] Withdrew ${totalWithdrawn} items from chest`);
                return 'success';
            } else {
                // Chest was empty - request materials from lumberjack
                bb.log?.debug('[Farmer] Chest empty, requesting materials');
                if (this.requestMaterialsIfNeeded(bb)) {
                    return 'running';  // Wait for lumberjack to deposit
                }
                return 'failure';
            }
        } catch (error) {
            bb.log?.warn({ err: error }, '[Farmer] Error checking chest');
            return 'failure';
        }
    }
}
