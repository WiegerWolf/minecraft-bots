import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BaseCheckChest } from '../../../../shared/actions';

/**
 * CheckSharedChest - Check shared chest for logs/planks for tool crafting.
 *
 * Landscaper-specific behavior:
 * - Checks when needs tools and doesn't have enough logs/planks
 * - Withdraws logs (priority 1), planks (priority 2, if no logs)
 * - Updates blackboard counts after withdrawal
 * - Requests logs from lumberjack if chest is empty
 */
export class CheckSharedChest extends BaseCheckChest<LandscaperBlackboard> {
    constructor() {
        super({
            withdrawalPriorities: [
                { pattern: '_log', maxAmount: 4 },
                { pattern: '_planks', maxAmount: 8, onlyIfPreviousEmpty: true },
            ],
            roleLabel: 'Landscaper',
            lastActionCheck: 'check_chest',
            postPathfindSleepMs: 200,
            postOpenSleepMs: 300,
            betweenWithdrawSleepMs: 100,
        });
    }

    protected hasSufficientMaterials(bb: LandscaperBlackboard): boolean {
        // Have enough if we have 2+ logs or 7+ planks
        return bb.logCount >= 2 || bb.plankCount >= 7;
    }

    protected findChest(bot: Bot, bb: LandscaperBlackboard): Vec3 | null {
        // ONLY use shared chest announced by lumberjack (who placed it)
        // Never adopt random nearby chests - they could be pregenerated
        // dungeon/mineshaft chests that are unreachable or underground
        if (bb.sharedChest) {
            const block = bot.blockAt(bb.sharedChest);
            if (block && ['chest', 'barrel'].includes(block.name)) {
                return bb.sharedChest;
            }
            bb.log?.debug(`[Landscaper] Shared chest at ${bb.sharedChest} no longer exists`);
        }

        // No shared chest available - must wait for lumberjack to place one
        return null;
    }

    protected override onWithdrawalComplete(
        bot: Bot,
        bb: LandscaperBlackboard,
        withdrawnByPattern: Map<string, number>
    ): void {
        // Update blackboard counts from inventory
        const inv = bot.inventory.items();
        bb.logCount = inv.filter(i => i.name.includes('_log')).reduce((s, i) => s + i.count, 0);
        bb.plankCount = inv.filter(i => i.name.endsWith('_planks')).reduce((s, i) => s + i.count, 0);

        bb.log?.debug(
            `[Landscaper] Retrieved materials from chest - logs: ${bb.logCount}, planks: ${bb.plankCount}`
        );
    }

    protected override onChestEmpty(bot: Bot, bb: LandscaperBlackboard): void {
        bb.log?.debug(`[Landscaper] Chest had no logs or planks available`);

        // Request logs from lumberjack if not already requested
        if (bb.villageChat && !bb.villageChat.hasPendingRequestFor('log')) {
            bb.log?.debug('[Landscaper] Requesting 2 logs from lumberjack');
            bb.villageChat.requestResource('log', 2);
        }
    }
}
