import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * DepositItems - Deposit dirt, cobblestone, etc. to shared chest
 */
export class DepositItems implements BehaviorNode {
    name = 'DepositItems';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        bb.lastAction = 'deposit_items';

        // Need a chest to deposit
        const chestPos = bb.sharedChest || (bb.nearbyChests.length > 0 ? bb.nearbyChests[0]!.position : null);
        if (!chestPos) {
            bb.log?.debug('[Landscaper] No chest available for deposit');
            return 'failure';
        }

        const chest = bot.blockAt(chestPos);
        if (!chest || !['chest', 'barrel'].includes(chest.name)) {
            bb.log?.debug('[Landscaper] Chest not found at expected position');
            return 'failure';
        }

        // Move to chest
        const result = await smartPathfinderGoto(
            bot,
            new GoalLookAtBlock(chestPos, bot.world, { reach: 4 }),
            { timeoutMs: 15000 }
        );
        if (!result.success) {
            bb.log?.debug(`[Landscaper] Path to chest failed: ${result.failureReason}`);
            return 'failure';
        }

        // Open chest
        let container;
        try {
            container = await bot.openContainer(chest);
        } catch (error) {
            bb.log?.debug(`[Landscaper] Failed to open chest: ${error instanceof Error ? error.message : 'unknown'}`);
            return 'failure';
        }

        // Items to deposit (keep tools)
        const depositTypes = ['dirt', 'cobblestone', 'gravel', 'sand', 'stone', 'andesite', 'diorite', 'granite'];

        let deposited = 0;
        for (const item of bot.inventory.items()) {
            if (depositTypes.includes(item.name)) {
                try {
                    await container.deposit(item.type, null, item.count);
                    deposited += item.count;
                    await sleep(100);
                } catch (error) {
                    // Chest might be full
                    break;
                }
            }
        }

        container.close();

        if (deposited > 0) {
            bb.log?.debug(`[Landscaper] Deposited ${deposited} items to chest`);
            if (bb.villageChat) {
                bb.villageChat.announceDeposit('materials', deposited);
            }
        }

        return 'success';
    }
}
