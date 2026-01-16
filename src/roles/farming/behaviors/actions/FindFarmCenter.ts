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
        // Use radius 0 - just check the water block itself, not surroundings
        // Shorelines are fine even if there are trees/hills on one side!
        const suitableWater = bb.nearbyWater.filter(w =>
            !isNearBadWater(bb, w.position) && hasClearSky(bot, w.position, 0)
        );

        // Record any cave water we found (only if the water itself is underground)
        for (const water of bb.nearbyWater) {
            if (!hasClearSky(bot, water.position, 0)) {
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
        // Search up to 128 blocks (8 chunks) - like a player scanning the horizon
        const waterBlocks = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 128,
            count: 50, // Find many candidates to filter
            matching: b => {
                if (!b || !b.name) return false;
                return b.name === 'water' || b.name === 'flowing_water';
            }
        });

        // Filter for water under clear sky (not in caves) and not near known bad water
        // Be lenient - just check if the water itself has sky above, shorelines are fine!
        const suitablePositions: Vec3[] = [];
        let caveWaterCount = 0;

        for (const pos of waterBlocks) {
            const vec = new Vec3(pos.x, pos.y, pos.z);

            // Skip if near known bad water
            if (isNearBadWater(bb, vec)) continue;

            // Just check if this water block has clear sky - radius 0
            if (hasClearSky(bot, vec, 0)) {
                suitablePositions.push(pos);
            } else {
                // Record this as bad water (underground)
                recordBadWater(bb, vec);
                caveWaterCount++;
            }
        }

        if (suitablePositions.length > 0) {
            // Sort by distance and prefer lower elevations (near sea level)
            const SEA_LEVEL = 63;
            const sortedPositions = suitablePositions
                .map(pos => ({
                    pos,
                    dist: bot.entity.position.distanceTo(pos),
                    heightScore: Math.abs(pos.y - SEA_LEVEL)
                }))
                .sort((a, b) => {
                    // Prefer positions near sea level, then closer ones
                    const heightDiff = a.heightScore - b.heightScore;
                    if (Math.abs(heightDiff) > 10) return heightDiff;
                    return a.dist - b.dist;
                });

            const best = sortedPositions[0];
            if (best) {
                const dist = Math.round(best.dist);
                console.log(`[BT] Found surface water at ${best.pos} (${dist} blocks away, Y=${best.pos.y}), moving to establish farm`);
                bb.lastAction = 'find_farm';

                try {
                    await bot.pathfinder.goto(new GoalNear(best.pos.x, best.pos.y, best.pos.z, 4));

                    // Set farm center directly
                    bb.farmCenter = new Vec3(best.pos.x, best.pos.y, best.pos.z);
                    console.log(`[BT] Established farm center at ${bb.farmCenter}`);

                    return 'success';
                } catch {
                    return 'failure';
                }
            }
        }

        if (waterBlocks.length > 0) {
            const badWaterMem = bb.badWaterPositions.length;
            console.log(`[BT] Found ${waterBlocks.length} water sources in 128-block range, ${caveWaterCount} in caves (${badWaterMem} bad locations remembered)`);
        } else {
            console.log(`[BT] No water found within 128 blocks`);
        }
        return 'failure';
    }
}
