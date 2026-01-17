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

// Blocks that are good for farming
const FARMABLE_GROUND = ['grass_block', 'dirt', 'farmland', 'coarse_dirt', 'rooted_dirt', 'podzol'];

/**
 * Calculate flatness score for a position.
 * Higher score = flatter terrain = less terraforming needed.
 */
function calculateFlatnessScore(bot: Bot, center: Vec3): number {
    const radius = 4; // Hydration range
    const targetY = center.y;
    let score = 100;

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            const x = Math.floor(center.x) + dx;
            const z = Math.floor(center.z) + dz;

            // Check surface level
            const surfacePos = new Vec3(x, targetY, z);
            const surfaceBlock = bot.blockAt(surfacePos);
            if (!surfaceBlock) continue;

            // Skip water
            if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water') continue;

            // Penalize non-farmable surface blocks
            if (!FARMABLE_GROUND.includes(surfaceBlock.name) && surfaceBlock.name !== 'air') {
                score -= 2;
            }

            // Check for obstacles above target level
            const aboveBlock = bot.blockAt(surfacePos.offset(0, 1, 0));
            if (aboveBlock && aboveBlock.name !== 'air' &&
                !aboveBlock.name.includes('grass') && !aboveBlock.name.includes('fern')) {
                score -= 3;
            }

            // Check for holes below target level
            const belowBlock = bot.blockAt(surfacePos.offset(0, -1, 0));
            if (belowBlock && belowBlock.name === 'air') {
                score -= 2;
            }
        }
    }

    return Math.max(0, score);
}

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

        // Filter for water under clear sky (not in caves)
        // Be lenient - just check if the water itself has sky above, shorelines are fine!
        // Use a smaller radius for badWater check (8 blocks) to avoid filtering all nearby water
        const suitablePositions: Vec3[] = [];
        let caveWaterCount = 0;

        for (const pos of waterBlocks) {
            const vec = new Vec3(pos.x, pos.y, pos.z);

            // Skip if VERY close to known bad water (use small radius to avoid over-filtering)
            if (isNearBadWater(bb, vec, 8)) continue;

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
            // Sort by distance, elevation, and flatness
            const SEA_LEVEL = 63;
            const sortedPositions = suitablePositions
                .map(pos => {
                    // Calculate flatness score (fewer blocks to terraform = better)
                    const flatnessScore = calculateFlatnessScore(bot, pos);
                    return {
                        pos,
                        dist: bot.entity.position.distanceTo(pos),
                        heightScore: Math.abs(pos.y - SEA_LEVEL),
                        flatnessScore
                    };
                })
                .sort((a, b) => {
                    // Prefer flatter terrain first
                    const flatnessDiff = b.flatnessScore - a.flatnessScore;
                    if (Math.abs(flatnessDiff) > 20) return flatnessDiff > 0 ? 1 : -1;
                    // Then prefer positions near sea level
                    const heightDiff = a.heightScore - b.heightScore;
                    if (Math.abs(heightDiff) > 10) return heightDiff;
                    // Then closer ones
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
                } catch (err) {
                    console.log(`[BT] Failed to reach water at ${best.pos}: ${err}`);
                    // Don't give up - still set farm center if we're reasonably close
                    const dist = bot.entity.position.distanceTo(best.pos);
                    if (dist < 32) {
                        bb.farmCenter = new Vec3(best.pos.x, best.pos.y, best.pos.z);
                        console.log(`[BT] Set farm center anyway (${Math.round(dist)} blocks away)`);
                        return 'success';
                    }
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
