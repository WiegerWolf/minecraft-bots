import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BaseDepositItems } from '../../../../shared/actions';

/**
 * DepositItems - Deposit dirt, cobblestone, etc. to shared chest.
 *
 * Landscaper-specific behavior:
 * - Always deposits when called (no threshold - controlled by goal)
 * - Prefers shared chest, falls back to nearby chests
 * - Deposits all terrain materials, keeps tools
 * - Announces deposits via village chat
 */
export class DepositItems extends BaseDepositItems<LandscaperBlackboard> {
    constructor() {
        super({
            depositFilter: {
                patterns: ['dirt', 'cobblestone', 'gravel', 'sand', 'stone', 'andesite', 'diorite', 'granite'],
                // No keepAmounts - deposit everything
            },
            roleLabel: 'Landscaper',
            lastActionDeposit: 'deposit_items',
            postPathfindSleepMs: 200,
            betweenDepositSleepMs: 100,
            announceType: 'materials',
        });
    }

    protected shouldDeposit(_bb: LandscaperBlackboard): boolean {
        // Always deposit when this action is called
        // (threshold checking is done at the goal level)
        return true;
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
        }
        return null;
    }
}
