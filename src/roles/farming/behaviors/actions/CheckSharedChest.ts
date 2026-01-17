import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CheckSharedChest - Check shared chest for materials and withdraw them
 *
 * Priority order for withdrawal:
 * 1. Logs (most efficient - 1 log = 4 planks)
 * 2. Planks (if no logs available)
 * 3. Sticks (if no planks available)
 */
export class CheckSharedChest implements BehaviorNode {
    name = 'CheckSharedChest';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Only check if we need tools
        if (!bb.needsTools) return 'failure';

        // Check if we have enough materials to craft a hoe
        const hasEnoughForHoe = (
            (bb.stickCount >= 2 && bb.plankCount >= 2) ||  // Direct materials
            bb.logCount >= 2  // 2 logs = 8 planks = enough for sticks + hoe
        );
        if (hasEnoughForHoe) return 'failure';

        // Get shared chest location from chat or nearby chests
        let sharedChest = bb.villageChat?.getSharedChest();

        if (!sharedChest) {
            // Look for a chest near farm center
            if (bb.nearbyChests.length > 0 && bb.farmCenter) {
                // Find chest closest to farm center
                const sortedChests = [...bb.nearbyChests].sort((a, b) =>
                    a.position.distanceTo(bb.farmCenter!) - b.position.distanceTo(bb.farmCenter!)
                );
                const chest = sortedChests[0];
                if (chest) {
                    sharedChest = chest.position;
                    if (bb.villageChat) {
                        bb.villageChat.setSharedChest(chest.position);
                        bb.villageChat.announceSharedChest(chest.position);
                    }
                }
            }
            if (!sharedChest) return 'failure';
        }

        const chest = bot.blockAt(sharedChest);
        if (!chest || !['chest', 'barrel'].includes(chest.name)) {
            return 'failure';
        }

        bb.lastAction = 'check_shared_chest';
        console.log('[Farmer] Checking shared chest for materials...');

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(chest.position, bot.world, { reach: 4 }));

            const chestWindow = await bot.openContainer(chest);
            await sleep(100);

            const chestItems = chestWindow.containerItems();
            let withdrew = false;

            // Priority 1: Withdraw logs (most efficient - 1 log = 4 planks)
            // Only withdraw if we need more materials
            if (bb.logCount < 2) {
                const logItem = chestItems.find(i => i.name.includes('_log'));
                if (logItem) {
                    const toWithdraw = Math.min(logItem.count, 4); // 4 logs = 16 planks
                    try {
                        await chestWindow.withdraw(logItem.type, null, toWithdraw);
                        console.log(`[Farmer] Withdrew ${toWithdraw} logs from shared chest`);
                        withdrew = true;
                    } catch (err) {
                        console.log(`[Farmer] Failed to withdraw logs: ${err}`);
                    }
                }
            }

            // Priority 2: Withdraw planks if no logs found and we need planks
            if (!withdrew && bb.plankCount < 4) {
                const plankItem = chestItems.find(i => i.name.endsWith('_planks'));
                if (plankItem) {
                    const toWithdraw = Math.min(plankItem.count, 8);
                    try {
                        await chestWindow.withdraw(plankItem.type, null, toWithdraw);
                        console.log(`[Farmer] Withdrew ${toWithdraw} planks from shared chest`);
                        withdrew = true;
                    } catch (err) {
                        console.log(`[Farmer] Failed to withdraw planks: ${err}`);
                    }
                }
            }

            // Priority 3: Withdraw sticks if needed
            if (bb.stickCount < 2) {
                const stickItem = chestItems.find(i => i.name === 'stick');
                if (stickItem) {
                    const toWithdraw = Math.min(stickItem.count, 8);
                    try {
                        await chestWindow.withdraw(stickItem.type, null, toWithdraw);
                        console.log(`[Farmer] Withdrew ${toWithdraw} sticks from shared chest`);
                        withdrew = true;
                    } catch (err) {
                        console.log(`[Farmer] Failed to withdraw sticks: ${err}`);
                    }
                }
            }

            chestWindow.close();
            return withdrew ? 'success' : 'failure';
        } catch (error) {
            console.warn('[Farmer] Error checking shared chest:', error);
            return 'failure';
        }
    }
}
