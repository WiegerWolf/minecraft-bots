import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BaseCheckChest } from '../../../../shared/actions';

// Cooldown duration after finding an empty chest (2 minutes)
const EMPTY_CHEST_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * CheckSharedChest - Check shared chest for logs/planks for tool crafting.
 *
 * Landscaper-specific behavior:
 * - Checks when needs tools and doesn't have enough logs/planks
 * - Withdraws logs (priority 1), planks (priority 2, if no logs)
 * - Updates blackboard counts after withdrawal
 * - Requests logs from lumberjack if chest is empty
 * - Cooldown prevents repeatedly checking an empty chest
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

    /**
     * Check if we're on cooldown from a recent empty chest check.
     */
    isOnCooldown(bb: LandscaperBlackboard): boolean {
        if (!bb.lastChestWasEmpty) return false;
        const timeSinceCheck = Date.now() - bb.lastChestCheckTime;
        return timeSinceCheck < EMPTY_CHEST_COOLDOWN_MS;
    }

    protected findChest(bot: Bot, bb: LandscaperBlackboard): Vec3 | null {
        // Don't check if we're on cooldown from a recent empty chest
        if (this.isOnCooldown(bb)) {
            const remaining = Math.round((EMPTY_CHEST_COOLDOWN_MS - (Date.now() - bb.lastChestCheckTime)) / 1000);
            bb.log?.debug(`[Landscaper] Chest check on cooldown (${remaining}s remaining)`);
            return null;
        }

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

        // Reset the empty chest tracking since we found materials
        bb.lastChestCheckTime = Date.now();
        bb.lastChestWasEmpty = false;

        bb.log?.debug(
            `[Landscaper] Retrieved materials from chest - logs: ${bb.logCount}, planks: ${bb.plankCount}`
        );
    }

    protected override onChestEmpty(bot: Bot, bb: LandscaperBlackboard): void {
        // Track that the chest was empty to prevent repeated checks
        bb.lastChestCheckTime = Date.now();
        bb.lastChestWasEmpty = true;

        bb.log?.debug(`[Landscaper] Chest had no logs or planks available (cooldown started)`);

        // Broadcast intent-based need for shovel (primary terraforming tool)
        // Lumberjack can respond with a shovel, planks+sticks, or logs
        if (bb.villageChat && !bb.villageChat.hasPendingNeedFor('shovel')) {
            bb.log?.debug('[Landscaper] Broadcasting need for shovel');
            bb.villageChat.broadcastNeed('shovel');
        }
    }
}
