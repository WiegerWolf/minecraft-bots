import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { LOG_NAMES } from '../../../shared/TreeHarvest';
import { pathfinderGotoWithRetry } from './utils';

const { GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * DepositLogs - Put logs, planks, sticks, and saplings in shared chest
 *
 * Deposits more frequently (8+ logs instead of 16+) to ensure farmer
 * can get materials quickly. Also announces deposits via chat.
 */
export class DepositLogs implements BehaviorNode {
    name = 'DepositLogs';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Check if there are pending requests for wood-related items
        const hasPendingRequests = bb.villageChat?.hasPendingRequestsToFulfill(['log', 'plank', 'stick']) ?? false;

        // Deposit threshold: 8+ logs normally, or any logs if there's a pending request
        const totalWoodItems = bb.logCount + bb.plankCount + bb.stickCount;
        const shouldDeposit = (
            bb.inventoryFull ||
            totalWoodItems >= 8 ||
            (hasPendingRequests && bb.logCount > 0)
        );

        if (!shouldDeposit) {
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

                // Queue sign write for discovered chest
                if (bb.spawnPosition) {
                    bb.pendingSignWrites.push({
                        type: 'CHEST',
                        pos: chestPos.clone()
                    });
                    bb.log?.debug({ type: 'CHEST', pos: chestPos.toString() }, 'Queued sign write for discovered chest');
                }
            } else {
                return 'failure'; // No chest available
            }
        }

        const chest = bot.blockAt(chestPos);
        if (!chest || !['chest', 'barrel'].includes(chest.name)) {
            bb.log?.debug(`[Lumberjack] Shared chest no longer exists at ${chestPos}`);
            bb.sharedChest = null;
            return 'failure';
        }

        bb.lastAction = 'deposit_logs';
        bb.log?.debug(`[Lumberjack] Depositing items to chest at ${chestPos}`);

        try {
            const success = await pathfinderGotoWithRetry(bot, new GoalLookAtBlock(chest.position, bot.world, { reach: 4 }));
            if (!success) {
                bb.log?.warn(`[Lumberjack] Failed to reach chest after retries`);
                return 'failure';
            }

            const chestWindow = await bot.openContainer(chest);
            await sleep(100);

            // Deposit wood-related items (keep saplings for replanting)
            const itemsToDeposit = bot.inventory.items().filter(item =>
                LOG_NAMES.includes(item.name) ||
                item.name.endsWith('_planks') ||
                item.name === 'stick'
            );

            let deposited = 0;
            let logsDeposited = 0;
            for (const item of itemsToDeposit) {
                try {
                    await chestWindow.deposit(item.type, null, item.count);
                    deposited += item.count;
                    if (LOG_NAMES.includes(item.name)) {
                        logsDeposited += item.count;
                    }
                    await sleep(50);
                } catch (err) {
                    // Chest might be full
                    bb.log?.debug(`[Lumberjack] Failed to deposit ${item.name}: ${err}`);
                    break;
                }
            }

            chestWindow.close();

            // If we had items to deposit but deposited nothing, chest is full
            if (itemsToDeposit.length > 0 && deposited === 0) {
                bb.log?.warn({ chestPos: chestPos.toString() }, 'Chest is full, clearing shared chest to find/craft new one');
                bb.sharedChest = null;
                return 'failure';
            }

            bb.log?.debug(`[Lumberjack] Deposited ${deposited} items (${logsDeposited} logs)`);

            // Announce deposit via chat so farmer knows materials are available
            if (logsDeposited > 0 && bb.villageChat) {
                bb.villageChat.announceDeposit('logs', logsDeposited);
            }

            return 'success';
        } catch (error) {
            bb.log?.warn({ err: error }, 'Error depositing items');
            return 'failure';
        }
    }
}
