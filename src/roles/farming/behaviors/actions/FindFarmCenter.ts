import type { Bot } from 'mineflayer';
import {
    type FarmingBlackboard,
    hasClearSky,
} from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

/**
 * Find and establish a farm center at a water source block.
 *
 * The farm center IS the water block - the landscaper will create
 * a 9x9 dirt area around it with the water in the center for irrigation.
 */
export class FindFarmCenter implements BehaviorNode {
    name = 'FindFarmCenter';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Already have a farm center
        if (bb.farmCenter) return 'failure';

        // Find water sources with clear sky
        let waterPositions: Vec3[] = [];

        // First check nearby water from blackboard
        const suitableWater = bb.nearbyWater.filter(w =>
            hasClearSky(bot, w.position, 0)
        );

        if (suitableWater.length > 0) {
            waterPositions = suitableWater.map(w => w.position.clone());
        } else {
            // Search more actively - try different ranges
            for (const maxDist of [32, 64, 96]) {
                const waterBlocks = bot.findBlocks({
                    point: bot.entity.position,
                    maxDistance: maxDist,
                    count: 50,
                    matching: b => b?.name === 'water'
                });

                for (const pos of waterBlocks) {
                    const vec = new Vec3(pos.x, pos.y, pos.z);
                    if (hasClearSky(bot, vec, 0)) {
                        waterPositions.push(vec);
                    }
                }

                if (waterPositions.length > 0) {
                    bb.log?.debug({ count: waterPositions.length, maxDist }, 'Found water sources');
                    break;
                }
            }
        }

        if (waterPositions.length === 0) {
            bb.log?.debug('No water with clear sky found within search range');
            return 'failure';
        }

        bb.log?.debug({ count: waterPositions.length }, 'Scoring water sources');

        // Score each water source based on suitability as farm center
        const scoredWater: { pos: Vec3; score: number }[] = [];

        for (const waterPos of waterPositions.slice(0, 15)) {
            const score = this.scoreWaterSource(bot, waterPos);
            if (score > 0) {
                scoredWater.push({ pos: waterPos, score });
            }
        }

        if (scoredWater.length === 0) {
            bb.log?.debug({ count: waterPositions.length }, 'All water sources scored 0 (need land around water)');
            return 'failure';
        }

        // Sort by score (higher is better) then by distance
        scoredWater.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return bot.entity.position.distanceTo(a.pos) - bot.entity.position.distanceTo(b.pos);
        });

        const best = scoredWater[0]!;
        const dist = Math.round(bot.entity.position.distanceTo(best.pos));
        bb.log?.info({ pos: best.pos.floored().toString(), dist, score: best.score }, 'Found water source for farm');

        bb.lastAction = 'find_farm';

        // Move near the water source
        const result = await smartPathfinderGoto(
            bot,
            new GoalNear(best.pos.x, best.pos.y, best.pos.z, 4),
            { timeoutMs: 30000 }
        );

        if (!result.success) {
            bb.log?.warn({ reason: result.failureReason }, 'Failed to reach water source');
            const currentDist = bot.entity.position.distanceTo(best.pos);
            if (currentDist >= 32) {
                return 'failure';
            }
        }

        // Set farm center to the WATER position - this is where the farm will be centered
        bb.farmCenter = best.pos.clone();
        bb.log?.info({ pos: bb.farmCenter.floored().toString() }, 'Established farm center (water)');

        // Request terraforming at the water position
        if (bb.villageChat) {
            bb.log?.info({ pos: bb.farmCenter.floored().toString() }, 'Requesting 9x9 farm around water');
            bb.villageChat.requestTerraform(bb.farmCenter);
        }

        return 'success';
    }

    /**
     * Score a water source based on how suitable it is as a farm center.
     * Higher score = better for farming.
     *
     * Good water sources:
     * - Have at least SOME land around them (at least 1 block)
     * - Are at ground level (not in a pit or on a cliff)
     * - Have clear sky above
     */
    private scoreWaterSource(bot: Bot, waterPos: Vec3): number {
        const waterY = waterPos.y;
        let score = 0;

        // Count how many of the 8 surrounding blocks at water level are solid ground
        let landCount = 0;
        let waterCount = 0;
        const directions = [
            { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
            { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
            { dx: 1, dz: 1 }, { dx: -1, dz: -1 },
            { dx: 1, dz: -1 }, { dx: -1, dz: 1 },
        ];

        for (const dir of directions) {
            const checkPos = new Vec3(
                Math.floor(waterPos.x) + dir.dx,
                waterY,
                Math.floor(waterPos.z) + dir.dz
            );
            const block = bot.blockAt(checkPos);
            const above = bot.blockAt(checkPos.offset(0, 1, 0));

            if (!block) continue; // Unloaded chunk

            if (block.name === 'water' || block.name === 'flowing_water') {
                waterCount++;
            } else if (block.boundingBox === 'block') {
                landCount++;
                // Extra points if the block above is air (walkable)
                if (above && above.name === 'air') {
                    score += 3;
                }
            }
        }

        // Need at least ONE adjacent land block (can reach the water)
        // But not ALL water (middle of ocean is bad)
        if (landCount < 1) return 0;

        // Prefer water on edges/shores (mix of land and water)
        score += landCount * 5;

        // Penalize being in middle of large water body
        if (waterCount >= 7) {
            score -= 20;
        }

        // Check the wider 9x9 area for buildable terrain
        let buildableCount = 0;
        let nullCount = 0; // Unloaded chunks

        for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
                if (dx === 0 && dz === 0) continue; // Skip water center

                const checkPos = new Vec3(
                    Math.floor(waterPos.x) + dx,
                    waterY,
                    Math.floor(waterPos.z) + dz
                );
                const block = bot.blockAt(checkPos);

                if (!block) {
                    nullCount++;
                    continue;
                }

                // Count blocks that are already suitable or can be made suitable
                if (block.name === 'water' || block.name === 'flowing_water') {
                    // Water is fine - landscaper can place dirt on top
                    buildableCount++;
                } else if (block.boundingBox === 'block') {
                    // Solid block at water level - good
                    buildableCount++;
                    const above = bot.blockAt(checkPos.offset(0, 1, 0));
                    if (above && above.name === 'air') {
                        score += 1; // Extra for clear above
                    }
                }
                // Air is also buildable (landscaper can fill)
                else if (block.name === 'air') {
                    buildableCount++;
                }
            }
        }

        // If too many blocks are unloaded, don't pick this spot
        if (nullCount > 40) return 0;

        // Need at least 20 buildable blocks (less strict than before)
        // Landscaper can handle filling water/air
        if (buildableCount < 20) return 0;

        score += buildableCount;

        // Bonus for clear sky
        if (hasClearSky(bot, waterPos.offset(0, 1, 0), 0)) {
            score += 20;
        }

        return score;
    }
}
