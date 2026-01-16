import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { LOG_NAMES, SAPLING_NAMES } from '../../../shared/TreeHarvest';
import { pathfinderGotoWithRetry } from './utils';

const { GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * DepositLogs - Put logs, planks, sticks, and saplings in shared chest
 */
export class DepositLogs implements BehaviorNode {
    name = 'DepositLogs';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Only deposit if we have enough items or inventory is getting full
        const totalWoodItems = bb.logCount + bb.plankCount + bb.stickCount;
        if (totalWoodItems < 16 && !bb.inventoryFull) {
            return 'failure';
        }

        // Find or use shared chest
        let chestPos = bb.sharedChest;

        if (!chestPos) {
            // Try to find a chest near village center
            if (bb.nearbyChests.length > 0) {
                chestPos = bb.nearbyChests[0]!.position;
                // Register it as shared chest
                if (bb.villageChat) {
                    bb.villageChat.announceSharedChest(chestPos);
                    bb.sharedChest = chestPos;
                }
            } else {
                return 'failure'; // No chest available
            }
        }

        const chest = bot.blockAt(chestPos);
        if (!chest || !['chest', 'barrel'].includes(chest.name)) {
            console.log(`[Lumberjack] Shared chest no longer exists at ${chestPos}`);
            bb.sharedChest = null;
            return 'failure';
        }

        bb.lastAction = 'deposit_logs';
        console.log(`[Lumberjack] Depositing items to chest at ${chestPos}`);

        try {
            const success = await pathfinderGotoWithRetry(bot, new GoalLookAtBlock(chest.position, bot.world, { reach: 4 }));
            if (!success) {
                console.warn(`[Lumberjack] Failed to reach chest after retries`);
                return 'failure';
            }

            const chestWindow = await bot.openContainer(chest);
            await sleep(100);

            // Deposit all wood-related items
            const itemsToDeposit = bot.inventory.items().filter(item =>
                LOG_NAMES.includes(item.name) ||
                item.name.endsWith('_planks') ||
                item.name === 'stick' ||
                SAPLING_NAMES.includes(item.name)
            );

            let deposited = 0;
            for (const item of itemsToDeposit) {
                try {
                    await chestWindow.deposit(item.type, null, item.count);
                    deposited += item.count;
                    await sleep(50);
                } catch (err) {
                    // Chest might be full
                    console.log(`[Lumberjack] Failed to deposit ${item.name}: ${err}`);
                    break;
                }
            }

            chestWindow.close();
            console.log(`[Lumberjack] Deposited ${deposited} items`);
            return 'success';
        } catch (error) {
            console.warn(`[Lumberjack] Error depositing items:`, error);
            return 'failure';
        }
    }
}
