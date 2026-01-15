import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

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

        // Try to find water nearby via blackboard
        if (bb.nearbyWater.length > 0) {
            const water = bb.nearbyWater[0];
            if (water) {
                bb.farmCenter = water.position.clone();
                console.log(`[BT] Established farm center at ${water.position}`);
                return 'success';
            }
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
                console.log(`[BT] Found water at ${waterPos}, moving to establish farm`);
                bb.lastAction = 'find_farm';

                try {
                    await bot.pathfinder.goto(new GoalNear(waterPos.x, waterPos.y, waterPos.z, 4));

                    // Set farm center directly
                    bb.farmCenter = new Vec3(waterPos.x, waterPos.y, waterPos.z);
                    console.log(`[BT] Established farm center at ${bb.farmCenter}`);

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
