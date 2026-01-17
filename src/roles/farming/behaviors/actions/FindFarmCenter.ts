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

// Blocks suitable for farming
const FARMABLE_GROUND = ['grass_block', 'dirt', 'farmland', 'coarse_dirt', 'rooted_dirt'];

/**
 * Find and establish a farm center near water.
 * Looks for flat LAND near water, not the water itself.
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
                matching: b => b?.name === 'water'  // Prefer still water
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

        // For each water source, find the best LAND position nearby for farming
        const farmCandidates: { landPos: Vec3; waterPos: Vec3; score: number }[] = [];

        for (const waterPos of waterPositions.slice(0, 10)) { // Check up to 10 water sources
            const landSpot = this.findFarmableLandNearWater(bot, waterPos);
            if (landSpot) {
                farmCandidates.push(landSpot);
            }
        }

        if (farmCandidates.length === 0) {
            console.log(`[BT] Found water but no suitable farmland nearby`);
            return 'failure';
        }

        // Sort by score (higher is better) then by distance
        farmCandidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return bot.entity.position.distanceTo(a.landPos) - bot.entity.position.distanceTo(b.landPos);
        });

        const best = farmCandidates[0]!;
        const dist = Math.round(bot.entity.position.distanceTo(best.landPos));
        console.log(`[BT] Found farm spot at ${best.landPos.floored()} near water at ${best.waterPos.floored()} (${dist} blocks, score: ${best.score})`);

        bb.lastAction = 'find_farm';

        const result = await smartPathfinderGoto(
            bot,
            new GoalNear(best.landPos.x, best.landPos.y, best.landPos.z, 3),
            { timeoutMs: 30000 }
        );

        if (!result.success) {
            console.log(`[BT] Failed to reach farm spot: ${result.failureReason}`);
            const currentDist = bot.entity.position.distanceTo(best.landPos);
            if (currentDist >= 32) {
                return 'failure';
            }
        }

        // Set farm center to the LAND position, not water
        bb.farmCenter = best.landPos.clone();
        console.log(`[BT] Established farm center at ${bb.farmCenter.floored()}`);

        // Request terraforming - send both land center and water position
        if (bb.villageChat) {
            console.log(`[Farmer] Requesting terraforming at ${bb.farmCenter.floored()} (water at ${best.waterPos.floored()})`);
            // For now, send land position - landscaper will find water nearby
            bb.villageChat.requestTerraform(bb.farmCenter);
        }

        return 'success';
    }

    /**
     * Find a good land position near water for farming.
     * Returns the land center position, water position, and quality score.
     */
    private findFarmableLandNearWater(bot: Bot, waterPos: Vec3): { landPos: Vec3; waterPos: Vec3; score: number } | null {
        const waterY = waterPos.y;

        // Check in cardinal directions from water for flat farmable land
        const directions = [
            { dx: 3, dz: 0 },  { dx: -3, dz: 0 },
            { dx: 0, dz: 3 },  { dx: 0, dz: -3 },
            { dx: 3, dz: 3 },  { dx: -3, dz: -3 },
            { dx: 3, dz: -3 }, { dx: -3, dz: 3 },
        ];

        let bestSpot: { landPos: Vec3; waterPos: Vec3; score: number } | null = null;

        for (const dir of directions) {
            const checkX = Math.floor(waterPos.x) + dir.dx;
            const checkZ = Math.floor(waterPos.z) + dir.dz;

            // Find ground level at this position
            let groundY: number | null = null;
            for (let y = waterY + 3; y >= waterY - 1; y--) {
                const block = bot.blockAt(new Vec3(checkX, y, checkZ));
                const above = bot.blockAt(new Vec3(checkX, y + 1, checkZ));
                if (block && FARMABLE_GROUND.includes(block.name) &&
                    above && (above.name === 'air' || above.name.includes('grass') || above.name.includes('flower'))) {
                    groundY = y;
                    break;
                }
            }

            if (groundY === null) continue;

            // Check if this is at a good level relative to water
            // Farmland works best at same level or 1 above water
            const yDiff = groundY - waterY;
            if (yDiff < 0 || yDiff > 2) continue;  // Skip if too low or too high

            // Score based on flatness around this point
            let score = 10;
            let flatCount = 0;

            // Check 5x5 area around this point for flatness
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const checkPos = new Vec3(checkX + dx, groundY, checkZ + dz);
                    const block = bot.blockAt(checkPos);
                    const above = bot.blockAt(checkPos.offset(0, 1, 0));

                    if (block && FARMABLE_GROUND.includes(block.name) &&
                        above && above.name === 'air') {
                        flatCount++;
                    }
                }
            }

            score += flatCount * 2;  // Bonus for flat area

            // Prefer same level as water (better irrigation)
            if (yDiff === 0) score += 10;
            else if (yDiff === 1) score += 5;

            // Check clear sky
            if (hasClearSky(bot, new Vec3(checkX, groundY + 1, checkZ), 0)) {
                score += 15;
            }

            const landPos = new Vec3(checkX, groundY, checkZ);

            if (!bestSpot || score > bestSpot.score) {
                bestSpot = { landPos, waterPos: waterPos.clone(), score };
            }
        }

        return bestSpot;
    }
}
