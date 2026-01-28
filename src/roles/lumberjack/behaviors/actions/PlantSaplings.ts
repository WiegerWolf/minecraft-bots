import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { GoalNear } from 'baritone-ts';
import { SAPLING_NAMES, CLEARABLE_VEGETATION } from '../../../shared/TreeHarvest';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';

// Minimum spacing between saplings to allow trees to grow
const SAPLING_SPACING = 5;

// Minimum distance from farmland to avoid planting saplings
// Trees can block sunlight and drop leaves on crops
const MIN_FARM_DISTANCE = 10;

/**
 * PlantSaplings - Plant saplings from inventory when not actively harvesting a tree
 *
 * This action runs independently of tree harvesting to ensure all collected
 * saplings get planted, maintaining the forest.
 */
export class PlantSaplings implements BehaviorNode {
    name = 'PlantSaplings';

    // Track where we've planted saplings to maintain spacing
    private plantedPositions: Vec3[] = [];
    private lastCleanup = 0;

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Don't plant while actively harvesting a tree (TreeHarvest handles that)
        if (bb.currentTreeHarvest) {
            return 'failure';
        }

        // Check if we have any saplings
        if (bb.saplingCount === 0) {
            return 'failure';
        }

        bb.lastAction = 'plant_saplings';

        // Clean up old planted positions periodically (saplings grow into trees)
        const now = Date.now();
        if (now - this.lastCleanup > 60000) {
            this.plantedPositions = this.plantedPositions.slice(-20);
            this.lastCleanup = now;
        }

        // Find a sapling in inventory
        const sapling = bot.inventory.items().find(i => SAPLING_NAMES.includes(i.name));
        if (!sapling) {
            return 'failure';
        }

        // If we know of forests, go to the nearest one that's not too close to farms
        // This ensures saplings are planted to regrow/expand forests, but avoids
        // wasting time going to forests that are near farms where planting is restricted
        if (bb.knownForests.length > 0) {
            // Filter forests that are far enough from all known farms
            const viableForests = bb.knownForests.filter(forest => {
                return !bb.knownFarms.some(farm => forest.distanceTo(farm) < MIN_FARM_DISTANCE + 5);
            });

            if (viableForests.length > 0) {
                const nearestForest = viableForests.reduce((nearest, forest) => {
                    const dist = bot.entity.position.distanceTo(forest);
                    const nearestDist = bot.entity.position.distanceTo(nearest);
                    return dist < nearestDist ? forest : nearest;
                });
                const distToForest = bot.entity.position.distanceTo(nearestForest);

                // If we're far from the forest, go there first
                if (distToForest > 20) {
                    bb.log?.debug({ forest: nearestForest.toString(), dist: Math.round(distToForest) }, '[Lumberjack] Going to forest to plant saplings');
                    const success = await pathfinderGotoWithRetry(bot, new GoalNear(nearestForest.x, nearestForest.y, nearestForest.z, 10));
                    if (!success) {
                        bb.log?.debug('[Lumberjack] Failed to reach forest for planting');
                        return 'failure';
                    }
                }
            } else if (bb.knownForests.length > 0) {
                bb.log?.debug('[Lumberjack] All known forests are too close to farms, searching from current location');
            }
        }

        // Find suitable planting spots (grass_block, dirt, podzol with air above)
        // Search in expanding radii to find spots even if nearby area is crowded
        const searchRadii = [16, 32, 48];
        let plantSpot: Vec3 | null = null;
        let needToClear: any = null;

        for (const radius of searchRadii) {
            const groundBlocks = bot.findBlocks({
                point: bot.entity.position,
                maxDistance: radius,
                count: 100,
                matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'podzol'
            });

            // Sort by distance from bot (prefer closer spots)
            groundBlocks.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));

            for (const groundPos of groundBlocks) {
                const surfacePos = groundPos.offset(0, 1, 0);
                const surfaceBlock = bot.blockAt(surfacePos);

                if (!surfaceBlock) continue;

                // Check spacing from recently planted saplings
                const tooClose = this.plantedPositions.some(
                    planted => planted.distanceTo(surfacePos) < SAPLING_SPACING
                );
                if (tooClose) continue;

                // Avoid planting near known farms (trees can block sunlight and drop leaves)
                const tooCloseToFarm = bb.knownFarms.some(
                    farm => surfacePos.distanceTo(farm) < MIN_FARM_DISTANCE
                );
                if (tooCloseToFarm) continue;

                // Also check for nearby farmland blocks directly (in case farms aren't in sign system)
                const nearbyFarmland = bot.findBlocks({
                    point: surfacePos,
                    maxDistance: MIN_FARM_DISTANCE - 1,
                    count: 1,
                    matching: b => b.name === 'farmland' || b.name === 'water'
                });
                if (nearbyFarmland.length > 0) continue;

                // Also check for existing saplings/trees nearby
                const nearbyBlocks = bot.findBlocks({
                    point: surfacePos,
                    maxDistance: SAPLING_SPACING - 1,
                    count: 1,
                    matching: b => SAPLING_NAMES.includes(b.name) || b.name.includes('_log')
                });
                if (nearbyBlocks.length > 0) continue;

                // Check surface - air is best, but we can clear vegetation
                if (surfaceBlock.name === 'air') {
                    plantSpot = surfacePos;
                    needToClear = null;
                    break;
                } else if (CLEARABLE_VEGETATION.includes(surfaceBlock.name)) {
                    if (!plantSpot) {
                        plantSpot = surfacePos;
                        needToClear = surfaceBlock;
                    }
                }
            }

            if (plantSpot) break;  // Found a spot, stop searching
        }

        if (!plantSpot) {
            bb.log?.debug({ saplings: bb.saplingCount }, '[Lumberjack] No suitable spots to plant saplings within search range');
            return 'failure';
        }

        try {
            // Move close to the planting spot
            const success = await pathfinderGotoWithRetry(bot, new GoalNear(plantSpot.x, plantSpot.y, plantSpot.z, 3));
            if (!success) {
                bb.log?.debug('[Lumberjack] Failed to reach planting spot');
                return 'failure';
            }

            // Clear vegetation if needed
            if (needToClear) {
                await bot.dig(needToClear);
                await sleep(100);
            }

            // Equip and place the sapling
            await bot.equip(sapling, 'hand');
            const groundBlock = bot.blockAt(plantSpot.offset(0, -1, 0));
            if (groundBlock) {
                await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                this.plantedPositions.push(plantSpot.clone());
                bb.log?.info({ pos: plantSpot.toString(), remaining: bb.saplingCount - 1 }, '[Lumberjack] Planted sapling');
                return 'success';
            }
        } catch (err) {
            bb.log?.debug({ err }, '[Lumberjack] Failed to plant sapling');
        }

        return 'failure';
    }
}
