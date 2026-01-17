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
            // Search more actively
            const waterBlocks = bot.findBlocks({
                point: bot.entity.position,
                maxDistance: 64,
                count: 30,
                matching: b => b?.name === 'water'
            });

            for (const pos of waterBlocks) {
                const vec = new Vec3(pos.x, pos.y, pos.z);
                if (hasClearSky(bot, vec, 0)) {
                    waterPositions.push(vec);
                }
            }
        }

        if (waterPositions.length === 0) {
            console.log(`[BT] No suitable water found nearby`);
            return 'failure';
        }

        // Score each water source based on suitability as farm center
        const scoredWater: { pos: Vec3; score: number }[] = [];

        for (const waterPos of waterPositions.slice(0, 15)) {
            const score = this.scoreWaterSource(bot, waterPos);
            if (score > 0) {
                scoredWater.push({ pos: waterPos, score });
            }
        }

        if (scoredWater.length === 0) {
            console.log(`[BT] Found water but none suitable for farming (need land around it)`);
            return 'failure';
        }

        // Sort by score (higher is better) then by distance
        scoredWater.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return bot.entity.position.distanceTo(a.pos) - bot.entity.position.distanceTo(b.pos);
        });

        const best = scoredWater[0]!;
        const dist = Math.round(bot.entity.position.distanceTo(best.pos));
        console.log(`[BT] Found water source for farm at ${best.pos.floored()} (${dist} blocks away, score: ${best.score})`);

        bb.lastAction = 'find_farm';

        // Move near the water source
        const result = await smartPathfinderGoto(
            bot,
            new GoalNear(best.pos.x, best.pos.y, best.pos.z, 4),
            { timeoutMs: 30000 }
        );

        if (!result.success) {
            console.log(`[BT] Failed to reach water source: ${result.failureReason}`);
            const currentDist = bot.entity.position.distanceTo(best.pos);
            if (currentDist >= 32) {
                return 'failure';
            }
        }

        // Set farm center to the WATER position - this is where the farm will be centered
        bb.farmCenter = best.pos.clone();
        console.log(`[BT] Established farm center (water) at ${bb.farmCenter.floored()}`);

        // Request terraforming at the water position
        if (bb.villageChat) {
            console.log(`[Farmer] Requesting 9x9 farm around water at ${bb.farmCenter.floored()}`);
            bb.villageChat.requestTerraform(bb.farmCenter);
        }

        return 'success';
    }

    /**
     * Score a water source based on how suitable it is as a farm center.
     * Higher score = better for farming.
     *
     * Good water sources:
     * - Have land around them (not in middle of ocean)
     * - Are at ground level (not in a pit or on a cliff)
     * - Have clear sky above
     * - Have relatively flat surrounding terrain
     */
    private scoreWaterSource(bot: Bot, waterPos: Vec3): number {
        const waterY = waterPos.y;
        let score = 0;

        // Count how many of the 8 surrounding blocks at water level are solid ground
        let landCount = 0;
        let airCount = 0;
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

            if (block && block.boundingBox === 'block' && block.name !== 'water') {
                landCount++;
                // Extra points if the block above is air (walkable)
                if (above && above.name === 'air') {
                    score += 2;
                }
            } else if (block && block.name === 'air') {
                airCount++;
            }
        }

        // Need at least some land around the water (not in middle of lake)
        if (landCount < 2) return 0;

        // Prefer water on edges (some land, some water/air) - like a shore
        score += landCount * 5;

        // Check the wider 9x9 area for buildable terrain
        let buildableCount = 0;
        for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
                if (dx === 0 && dz === 0) continue; // Skip water center

                const checkPos = new Vec3(
                    Math.floor(waterPos.x) + dx,
                    waterY,
                    Math.floor(waterPos.z) + dz
                );
                const block = bot.blockAt(checkPos);
                const above = bot.blockAt(checkPos.offset(0, 1, 0));

                // Count blocks that are already suitable or can be made suitable
                if (block) {
                    if (block.name === 'water' || block.name === 'flowing_water') {
                        // Water is fine - landscaper can place dirt on top
                        buildableCount++;
                    } else if (block.boundingBox === 'block') {
                        // Solid block at water level - good
                        buildableCount++;
                        if (above && above.name === 'air') {
                            score += 1; // Extra for clear above
                        }
                    }
                }
            }
        }

        // Need enough buildable area
        if (buildableCount < 40) return 0; // At least half the 9x9 area

        score += buildableCount;

        // Bonus for clear sky
        if (hasClearSky(bot, waterPos.offset(0, 1, 0), 0)) {
            score += 20;
        }

        return score;
    }
}
