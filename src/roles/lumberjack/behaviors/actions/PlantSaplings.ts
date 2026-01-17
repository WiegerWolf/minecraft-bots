import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { SAPLING_NAMES, CLEARABLE_VEGETATION } from '../../../shared/TreeHarvest';
import { pathfinderGotoWithRetry } from './utils';

const { GoalNear } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Minimum spacing between saplings to allow trees to grow
const SAPLING_SPACING = 5;

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

        // Find suitable planting spots (grass_block, dirt, podzol with air above)
        const groundBlocks = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 24,
            count: 50,
            matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'podzol'
        });

        let plantSpot: Vec3 | null = null;
        let needToClear: any = null;

        for (const groundPos of groundBlocks) {
            const surfacePos = groundPos.offset(0, 1, 0);
            const surfaceBlock = bot.blockAt(surfacePos);

            if (!surfaceBlock) continue;

            // Check spacing from recently planted saplings
            const tooClose = this.plantedPositions.some(
                planted => planted.distanceTo(surfacePos) < SAPLING_SPACING
            );
            if (tooClose) continue;

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

        if (!plantSpot) {
            bb.log?.debug('[Lumberjack] No suitable spots to plant saplings');
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
