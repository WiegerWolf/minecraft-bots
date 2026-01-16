import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear, GoalLookAtBlock } = goals;

const LOG_NAMES = [
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
    'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'
];

const LEAF_NAMES = [
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
    'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
    'azalea_leaves', 'flowering_azalea_leaves'
];

const SAPLING_MAP: Record<string, string> = {
    'oak_log': 'oak_sapling',
    'birch_log': 'birch_sapling',
    'spruce_log': 'spruce_sapling',
    'jungle_log': 'jungle_sapling',
    'acacia_log': 'acacia_sapling',
    'dark_oak_log': 'dark_oak_sapling',
    'mangrove_log': 'mangrove_propagule',
    'cherry_log': 'cherry_sapling',
};

/**
 * GatherWood behavior - harvests trees sustainably.
 * Can be used in two modes:
 * 1. startNewTreeOnly=false (default): Continues existing harvest OR starts new if needed
 * 2. startNewTreeOnly=true: Only starts new trees, ignores existing harvest
 */
export class GatherWood implements BehaviorNode {
    name = 'GatherWood';
    private startNewTreeOnly: boolean;

    constructor(startNewTreeOnly: boolean = false) {
        this.startNewTreeOnly = startNewTreeOnly;
    }

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // If we're only supposed to start new trees (called from GetTools sequence)
        if (this.startNewTreeOnly) {
            if (bb.currentTreeHarvest) return 'failure'; // Let FinishTreeHarvest handle it
            if (bb.hasHoe) return 'failure';
            if (bb.plankCount >= 4) return 'failure';
            if (bb.logCount > 0) return 'failure';

            bb.lastAction = 'gather_wood';
            return this.findAndStartTree(bot, bb);
        }

        // Default mode: finish existing harvest first
        if (bb.currentTreeHarvest) {
            bb.lastAction = 'gather_wood';
            return this.continueHarvest(bot, bb);
        }

        // Only start a new tree if we need wood
        if (bb.hasHoe) return 'failure';
        if (bb.plankCount >= 4) return 'failure';
        if (bb.logCount > 0) return 'failure';

        bb.lastAction = 'gather_wood';

        // Find a new tree to harvest
        return this.findAndStartTree(bot, bb);
    }

    private async findAndStartTree(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        const logs = bot.findBlocks({
            matching: b => LOG_NAMES.includes(b.name),
            maxDistance: 32,
            count: 10
        });

        if (logs.length === 0) return 'failure';

        // Find the lowest log (tree base)
        let baseLog: Block | null = null;
        for (const logPos of logs) {
            const block = bot.blockAt(logPos);
            if (!block) continue;

            // Skip logs too high to reach initially
            if (block.position.y > bot.entity.position.y + 3) continue;

            // Check if this is a tree base (has dirt/grass below)
            const below = bot.blockAt(block.position.offset(0, -1, 0));
            if (below && ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt'].includes(below.name)) {
                baseLog = block;
                break;
            }

            // If no clear base found yet, use the lowest reachable log
            if (!baseLog || block.position.y < baseLog.position.y) {
                baseLog = block;
            }
        }

        if (!baseLog) return 'failure';

        // Start harvesting this tree (store in blackboard so it persists)
        bb.currentTreeHarvest = {
            basePos: baseLog.position.clone(),
            logType: baseLog.name,
            phase: 'chopping'
        };

        console.log(`[BT] Starting to harvest ${baseLog.name.replace('_log', '')} tree at ${baseLog.position}`);

        return this.continueHarvest(bot, bb);
    }

    private async continueHarvest(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        switch (bb.currentTreeHarvest.phase) {
            case 'chopping':
                return this.chopLogs(bot, bb);
            case 'clearing_leaves':
                return this.clearLeaves(bot, bb);
            case 'replanting':
                return this.replantSapling(bot, bb);
            case 'done':
                bb.currentTreeHarvest = null;
                return 'failure'; // Allow other behaviors to run
        }
    }

    private async chopLogs(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        // Find remaining logs in a column above the base
        const baseX = Math.floor(bb.currentTreeHarvest.basePos.x);
        const baseZ = Math.floor(bb.currentTreeHarvest.basePos.z);

        for (let dy = 0; dy < 20; dy++) {
            const y = Math.floor(bb.currentTreeHarvest.basePos.y) + dy;
            const block = bot.blockAt(new Vec3(baseX, y, baseZ));

            if (block && LOG_NAMES.includes(block.name)) {
                // Check if reachable
                if (block.position.y > bot.entity.position.y + 4) {
                    // Too high, but might be able to pillar up or wait for it to fall
                    // For now, move to clearing leaves
                    break;
                }

                console.log(`[BT] Chopping ${block.name} at ${block.position}`);

                try {
                    const goal = new GoalLookAtBlock(block.position, bot.world, { reach: 4 });
                    await bot.pathfinder.goto(goal);
                    await bot.dig(block);
                    await sleep(150);
                    return 'success';
                } catch {
                    // Try from current position if close
                    const dist = bot.entity.position.distanceTo(block.position);
                    if (dist < 5) {
                        try {
                            await bot.dig(block);
                            return 'success';
                        } catch {
                            // Move to next phase
                            break;
                        }
                    }
                    break;
                }
            }
        }

        // No more logs in column, move to clearing leaves
        console.log(`[BT] Tree trunk cleared, removing leaves...`);
        bb.currentTreeHarvest.phase = 'clearing_leaves';
        return 'success';
    }

    private async clearLeaves(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        // Find leaves near where the tree was - search higher up where the canopy was
        const searchCenter = bb.currentTreeHarvest.basePos.offset(0, 5, 0);

        const leaves = bot.findBlocks({
            point: searchCenter,
            maxDistance: 7,
            count: 50,
            matching: b => LEAF_NAMES.includes(b.name)
        });

        // Sort by distance and height - prefer lower, closer leaves
        const sortedLeaves = leaves
            .map(pos => ({
                pos,
                dist: bot.entity.position.distanceTo(pos),
                heightAbove: pos.y - bot.entity.position.y
            }))
            .filter(l => l.heightAbove <= 5) // Can reach up to 5 blocks above
            .sort((a, b) => {
                // Prefer closer leaves, then lower ones
                if (Math.abs(a.dist - b.dist) > 2) return a.dist - b.dist;
                return a.heightAbove - b.heightAbove;
            });

        if (sortedLeaves.length === 0) {
            // No more reachable leaves, move to replanting
            console.log(`[BT] Leaves cleared, checking for sapling to replant...`);
            bb.currentTreeHarvest.phase = 'replanting';
            return 'success';
        }

        const leafData = sortedLeaves[0];
        if (!leafData) {
            bb.currentTreeHarvest.phase = 'replanting';
            return 'success';
        }

        const leafBlock = bot.blockAt(leafData.pos);
        if (!leafBlock) {
            bb.currentTreeHarvest.phase = 'replanting';
            return 'success';
        }

        console.log(`[BT] Breaking leaves at ${leafBlock.position}`);

        try {
            const goal = new GoalLookAtBlock(leafBlock.position, bot.world, { reach: 5 });
            await bot.pathfinder.goto(goal);
            await bot.dig(leafBlock);
            await sleep(100);
            return 'success';
        } catch {
            // Try from current position
            const dist = bot.entity.position.distanceTo(leafBlock.position);
            if (dist < 6) {
                try {
                    await bot.dig(leafBlock);
                    return 'success';
                } catch {
                    // Skip this leaf
                }
            }
            // Move on after a few failures
            bb.currentTreeHarvest.phase = 'replanting';
            return 'success';
        }
    }

    // Track where we've planted saplings to maintain spacing
    private plantedSaplingPositions: Vec3[] = [];

    private async replantSapling(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        const saplingName = SAPLING_MAP[bb.currentTreeHarvest.logType];
        if (!saplingName) {
            bb.currentTreeHarvest.phase = 'done';
            return 'success';
        }

        // Check if we have any saplings left to plant
        const sapling = bot.inventory.items().find(i => i.name === saplingName);
        if (!sapling) {
            const planted = this.plantedSaplingPositions.length;
            if (planted > 0) {
                console.log(`[BT] Finished planting ${planted} saplings`);
                this.plantedSaplingPositions = [];
            } else {
                console.log(`[BT] No ${saplingName} to replant`);
            }
            bb.currentTreeHarvest.phase = 'done';
            return 'success';
        }

        // Blocks that can be cleared to make room for sapling
        const clearableVegetation = [
            'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
            'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
            'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
            'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
            'dead_bush', 'sweet_berry_bush'
        ];

        const SAPLING_SPACING = 5; // Blocks apart for trees to grow

        // Find grass_blocks nearby
        const grassBlocks = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 24,
            count: 50,
            matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'podzol'
        });

        let plantSpot: Vec3 | null = null;
        let needToClear: Block | null = null;

        for (const groundPos of grassBlocks) {
            const surfacePos = groundPos.offset(0, 1, 0);
            const surfaceBlock = bot.blockAt(surfacePos);

            if (!surfaceBlock) continue;

            // Check spacing from previously planted saplings
            const tooClose = this.plantedSaplingPositions.some(
                planted => planted.distanceTo(surfacePos) < SAPLING_SPACING
            );
            if (tooClose) continue;

            // Also check for existing saplings/trees nearby
            const nearbyTree = bot.findBlocks({
                point: surfacePos,
                maxDistance: SAPLING_SPACING - 1,
                count: 1,
                matching: b => b.name.includes('sapling') || b.name.includes('log')
            });
            if (nearbyTree.length > 0) continue;

            // Check surface - air is best, but we can clear vegetation
            if (surfaceBlock.name === 'air') {
                plantSpot = surfacePos;
                needToClear = null;
                break;
            } else if (clearableVegetation.includes(surfaceBlock.name)) {
                if (!plantSpot) {
                    plantSpot = surfacePos;
                    needToClear = surfaceBlock;
                }
            }
        }

        if (!plantSpot) {
            const planted = this.plantedSaplingPositions.length;
            if (planted > 0) {
                console.log(`[BT] Finished planting ${planted} saplings (no more suitable spots)`);
            } else {
                console.log(`[BT] No suitable spot to replant sapling`);
            }
            this.plantedSaplingPositions = [];
            bb.currentTreeHarvest.phase = 'done';
            return 'success';
        }

        try {
            // Move close to the planting spot
            await bot.pathfinder.goto(new GoalNear(plantSpot.x, plantSpot.y, plantSpot.z, 3));

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
                this.plantedSaplingPositions.push(plantSpot.clone());
                console.log(`[BT] Planted sapling ${this.plantedSaplingPositions.length} at ${plantSpot}`);
            }
        } catch (err) {
            console.log(`[BT] Failed to plant sapling: ${err}`);
        }

        // Stay in replanting phase to plant more saplings
        return 'success';
    }
}
