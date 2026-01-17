import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CheckSharedChest - Go to the shared chest and withdraw logs/planks for tool crafting
 */
export class CheckSharedChest implements BehaviorNode {
    name = 'CheckSharedChest';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // Need a shared chest to check
        if (!bb.sharedChest) {
            console.log('[Landscaper] No shared chest known');
            return 'failure';
        }

        // Already have enough materials
        if (bb.logCount >= 2 || bb.plankCount >= 7) {
            return 'failure';
        }

        bb.lastAction = 'check_chest';

        const chestPos = bb.sharedChest;
        const chestBlock = bot.blockAt(chestPos);

        if (!chestBlock || !['chest', 'barrel'].includes(chestBlock.name)) {
            console.log(`[Landscaper] Shared chest at ${chestPos} no longer exists`);
            return 'failure';
        }

        try {
            // Navigate to chest
            console.log(`[Landscaper] Going to shared chest at ${chestPos}`);
            await bot.pathfinder.goto(new GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
            await sleep(200);

            // Open chest
            const chest = await bot.openContainer(chestBlock);
            await sleep(300);

            // Look for logs first, then planks
            let withdrawnLogs = 0;
            let withdrawnPlanks = 0;

            // Withdraw logs (prefer logs since they convert to more planks)
            for (const item of chest.containerItems()) {
                if (item.name.includes('_log') && withdrawnLogs < 4) {
                    const toWithdraw = Math.min(item.count, 4 - withdrawnLogs);
                    try {
                        await chest.withdraw(item.type, null, toWithdraw);
                        withdrawnLogs += toWithdraw;
                        console.log(`[Landscaper] Withdrew ${toWithdraw} ${item.name} from chest`);
                        await sleep(100);
                    } catch (err) {
                        console.warn(`[Landscaper] Failed to withdraw ${item.name}:`, err);
                    }
                }
            }

            // If we didn't get enough logs, try planks
            if (withdrawnLogs < 2) {
                for (const item of chest.containerItems()) {
                    if (item.name.endsWith('_planks') && withdrawnPlanks < 8) {
                        const toWithdraw = Math.min(item.count, 8 - withdrawnPlanks);
                        try {
                            await chest.withdraw(item.type, null, toWithdraw);
                            withdrawnPlanks += toWithdraw;
                            console.log(`[Landscaper] Withdrew ${toWithdraw} ${item.name} from chest`);
                            await sleep(100);
                        } catch (err) {
                            console.warn(`[Landscaper] Failed to withdraw ${item.name}:`, err);
                        }
                    }
                }
            }

            // Close chest
            chest.close();
            await sleep(100);

            // Update blackboard counts
            const inv = bot.inventory.items();
            bb.logCount = inv.filter(i => i.name.includes('_log')).reduce((s, i) => s + i.count, 0);
            bb.plankCount = inv.filter(i => i.name.endsWith('_planks')).reduce((s, i) => s + i.count, 0);

            if (withdrawnLogs > 0 || withdrawnPlanks > 0) {
                console.log(`[Landscaper] Retrieved materials from chest - logs: ${bb.logCount}, planks: ${bb.plankCount}`);
                return 'success';
            } else {
                console.log(`[Landscaper] Chest had no logs or planks available`);
                return 'failure';
            }
        } catch (err) {
            console.warn(`[Landscaper] Failed to check shared chest:`, err);
            return 'failure';
        }
    }
}
