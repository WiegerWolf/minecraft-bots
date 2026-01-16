import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear, GoalLookAtBlock } = goals;

// Blocks that should be cleared from the farm area
const CLEARABLE_BLOCKS = [
    // Trees
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
    // Saplings
    'oak_sapling', 'birch_sapling', 'spruce_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'mangrove_propagule', 'cherry_sapling',
    // Vegetation that blocks farming
    'tall_grass', 'large_fern', 'tall_seagrass',
    // Mushrooms
    'brown_mushroom', 'red_mushroom',
];

// Blocks that should be cleared if they're above the farm plane (raised terrain)
const TERRAIN_BLOCKS = [
    'dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium',
    'sand', 'gravel', 'clay',
];

export class ClearFarmArea implements BehaviorNode {
    name = 'ClearFarmArea';
    private lastClearTime = 0;
    private clearedCount = 0;

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Need a farm center to clear around
        if (!bb.farmCenter) return 'failure';

        // Don't clear too frequently (give other actions a chance)
        if (Date.now() - this.lastClearTime < 500) {
            return 'failure';
        }

        const farmY = bb.farmCenter.y;
        const centerX = bb.farmCenter.x;
        const centerZ = bb.farmCenter.z;

        // Find blocks that need clearing in a 9x9 area (hydration range)
        const blockToClear = this.findBlockToClear(bot, centerX, centerZ, farmY);

        if (!blockToClear) {
            // Nothing to clear - area is ready
            if (this.clearedCount > 0) {
                console.log(`[BT] Farm area cleared (${this.clearedCount} blocks removed)`);
                this.clearedCount = 0;
            }
            return 'failure';
        }

        this.lastClearTime = Date.now();
        bb.lastAction = 'clear_farm';

        const blockType = this.getBlockCategory(blockToClear);
        console.log(`[BT] Clearing ${blockType} at ${blockToClear.position} (${blockToClear.name})`);

        try {
            // Move close enough to break if we can't already
            if (!bot.canDigBlock(blockToClear)) {
                const goal = new GoalLookAtBlock(blockToClear.position, bot.world, { reach: 4 });
                await bot.pathfinder.goto(goal);
            } else {
                console.log(`[BT] Already within reach to clear ${blockToClear.position}, skipping movement`);
            }

            // Break the block
            await bot.dig(blockToClear);
            await sleep(100);

            this.clearedCount++;
            return 'success';
        } catch (err) {
            // Pathfinding failed, try from current position if close enough
            const dist = bot.entity.position.distanceTo(blockToClear.position);
            if (dist < 5) {
                try {
                    await bot.dig(blockToClear);
                    this.clearedCount++;
                    return 'success';
                } catch {
                    return 'failure';
                }
            }
            return 'failure';
        }
    }

    private findBlockToClear(bot: Bot, centerX: number, centerZ: number, farmY: number): Block | null {
        // Search in expanding rings from center
        for (let radius = 0; radius <= 5; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    // Only check the current ring
                    if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                    const x = Math.floor(centerX) + dx;
                    const z = Math.floor(centerZ) + dz;

                    // Check vertically from farm level up to 15 blocks (for trees)
                    for (let dy = 0; dy <= 15; dy++) {
                        const y = Math.floor(farmY) + dy;
                        const block = bot.blockAt(new Vec3(x, y, z));
                        if (!block) continue;

                        // Check if it's a clearable block (trees, leaves, etc.)
                        if (CLEARABLE_BLOCKS.includes(block.name)) {
                            return block;
                        }

                        // Check if it's raised terrain that needs leveling
                        // Only clear terrain blocks that are ABOVE the farm plane (farmY + 1)
                        if (dy >= 1 && TERRAIN_BLOCKS.includes(block.name)) {
                            // Make sure there's air above (not buried underground)
                            const above = bot.blockAt(block.position.offset(0, 1, 0));
                            if (above && (above.name === 'air' || CLEARABLE_BLOCKS.includes(above.name))) {
                                return block;
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    private getBlockCategory(block: Block): string {
        if (block.name.includes('log')) return 'tree trunk';
        if (block.name.includes('leaves')) return 'leaves';
        if (block.name.includes('sapling')) return 'sapling';
        if (TERRAIN_BLOCKS.includes(block.name)) return 'raised terrain';
        return 'obstruction';
    }
}
