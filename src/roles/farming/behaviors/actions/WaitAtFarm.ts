import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { sleep } from './utils';

const { GoalNear } = goals;

/**
 * Wait near the farm center when there's nothing else to do.
 * This prevents the bot from running away while crops are growing.
 */
export class WaitAtFarm implements BehaviorNode {
    name = 'WaitAtFarm';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Only wait if we have a farm center
        if (!bb.farmCenter) return 'failure';

        // Check if we're already near the farm
        const dist = bot.entity.position.distanceTo(bb.farmCenter);
        if (dist > 8) {
            console.log(`[BT] Returning to farm center to wait for crops`);
            await smartPathfinderGoto(
                bot,
                new GoalNear(bb.farmCenter.x, bb.farmCenter.y, bb.farmCenter.z, 4),
                { timeoutMs: 15000 }
            );
            // Ignore pathfinding errors
        }

        // Look around randomly to simulate waiting
        const randomYaw = Math.random() * Math.PI * 2;
        await bot.look(randomYaw, 0, false);

        bb.lastAction = 'wait';
        console.log(`[BT] Waiting at farm for crops to grow...`);
        await sleep(2000);  // Wait a bit longer between checks

        return 'success';
    }
}
