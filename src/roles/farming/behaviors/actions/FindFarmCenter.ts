import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

/**
 * Find and establish a farm center near water.
 * This action helps the bot locate a suitable farming location.
 */
export class FindFarmCenter implements BehaviorNode {
    name = 'FindFarmCenter';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Already have a farm center
        if (bb.farmCenter) return 'failure';

        // Try to find water nearby
        if (bb.nearbyWater.length > 0) {
            // Water found - farm center will be set by Blackboard
            console.log(`[BT] Found water source, establishing farm center`);
            return 'success';
        }

        // No water in perception range, search more actively
        const waterBlocks = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 64,
            count: 1,
            matching: b => {
                if (!b || !b.name) return false;
                return b.name === 'water' || b.name === 'flowing_water';
            }
        });

        if (waterBlocks.length > 0) {
            const waterPos = waterBlocks[0];
            if (waterPos) {
                console.log(`[BT] Found water at ${waterPos}, moving closer`);
                bb.lastAction = 'find_farm';

                try {
                    await bot.pathfinder.goto(new GoalNear(waterPos.x, waterPos.y, waterPos.z, 8));
                    return 'success';
                } catch {
                    return 'failure';
                }
            }
        }

        console.log(`[BT] No water found in range`);
        return 'failure';
    }
}
