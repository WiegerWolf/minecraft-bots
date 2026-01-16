import type { Bot } from 'mineflayer';
import {
    type FarmingBlackboard,
    hasClearSky,
    recordBadWater,
    isNearBadWater
} from '../../Blackboard';
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

        // Try to find water nearby via blackboard - must be under clear sky
        const suitableWater = bb.nearbyWater.filter(w =>
            !isNearBadWater(bb, w.position) && hasClearSky(bot, w.position, 4)
        );

        // Record any cave water we found
        for (const water of bb.nearbyWater) {
            if (!hasClearSky(bot, water.position, 4)) {
                recordBadWater(bb, water.position);
            }
        }

        if (suitableWater.length > 0) {
            const water = suitableWater[0];
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
            count: 20, // Find multiple candidates to filter
            matching: b => {
                if (!b || !b.name) return false;
                return b.name === 'water' || b.name === 'flowing_water';
            }
        });

        // Filter for water under clear sky (not in caves) and not near known bad water
        const suitablePositions: Vec3[] = [];
        let caveWaterCount = 0;

        for (const pos of waterBlocks) {
            const vec = new Vec3(pos.x, pos.y, pos.z);

            // Skip if near known bad water
            if (isNearBadWater(bb, vec)) continue;

            if (hasClearSky(bot, vec, 4)) {
                suitablePositions.push(pos);
            } else {
                // Record this as bad water
                recordBadWater(bb, vec);
                caveWaterCount++;
            }
        }

        if (suitablePositions.length > 0) {
            const waterPos = suitablePositions[0];
            if (waterPos) {
                console.log(`[BT] Found surface water at ${waterPos}, moving to establish farm`);
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

        if (waterBlocks.length > 0) {
            const badWaterMem = bb.badWaterPositions.length;
            console.log(`[BT] Found ${waterBlocks.length} water sources, ${caveWaterCount} in caves (${badWaterMem} total bad locations remembered)`);
        } else {
            console.log(`[BT] No water found in range`);
        }
        return 'failure';
    }
}
