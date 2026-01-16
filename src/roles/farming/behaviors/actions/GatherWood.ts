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

interface TreeHarvestState {
    basePos: Vec3;
    logType: string;
    phase: 'chopping' | 'clearing_leaves' | 'replanting' | 'done';
}

export class GatherWood implements BehaviorNode {
    name = 'GatherWood';
    private currentTree: TreeHarvestState | null = null;

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.hasHoe) return 'failure';
        if (bb.plankCount >= 4) return 'failure';
        if (bb.logCount > 0 && !this.currentTree) return 'failure';

        bb.lastAction = 'gather_wood';

        // Continue harvesting current tree if we have one
        if (this.currentTree) {
            return this.continueHarvest(bot, bb);
        }

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

        // Start harvesting this tree
        this.currentTree = {
            basePos: baseLog.position.clone(),
            logType: baseLog.name,
            phase: 'chopping'
        };

        console.log(`[BT] Starting to harvest ${baseLog.name.replace('_log', '')} tree at ${baseLog.position}`);

        return this.continueHarvest(bot, bb);
    }

    private async continueHarvest(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!this.currentTree) return 'failure';

        switch (this.currentTree.phase) {
            case 'chopping':
                return this.chopLogs(bot);
            case 'clearing_leaves':
                return this.clearLeaves(bot);
            case 'replanting':
                return this.replantSapling(bot, bb);
            case 'done':
                this.currentTree = null;
                return 'failure'; // Allow other behaviors to run
        }
    }

    private async chopLogs(bot: Bot): Promise<BehaviorStatus> {
        if (!this.currentTree) return 'failure';

        // Find remaining logs in a column above the base
        const baseX = Math.floor(this.currentTree.basePos.x);
        const baseZ = Math.floor(this.currentTree.basePos.z);

        for (let dy = 0; dy < 20; dy++) {
            const y = Math.floor(this.currentTree.basePos.y) + dy;
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
        this.currentTree.phase = 'clearing_leaves';
        return 'success';
    }

    private async clearLeaves(bot: Bot): Promise<BehaviorStatus> {
        if (!this.currentTree) return 'failure';

        // Find leaves near where the tree was
        const searchCenter = this.currentTree.basePos.offset(0, 3, 0);

        const leaves = bot.findBlocks({
            point: searchCenter,
            maxDistance: 6,
            count: 20,
            matching: b => LEAF_NAMES.includes(b.name)
        });

        // Filter to leaves we can reach
        const reachableLeaves = leaves.filter(pos => {
            return pos.y <= bot.entity.position.y + 4;
        });

        if (reachableLeaves.length === 0) {
            // No more reachable leaves, move to replanting
            console.log(`[BT] Leaves cleared, checking for sapling to replant...`);
            this.currentTree.phase = 'replanting';
            return 'success';
        }

        const leafPos = reachableLeaves[0];
        if (!leafPos) {
            this.currentTree.phase = 'replanting';
            return 'success';
        }

        const leafBlock = bot.blockAt(leafPos);
        if (!leafBlock) {
            this.currentTree.phase = 'replanting';
            return 'success';
        }

        console.log(`[BT] Breaking leaves at ${leafBlock.position}`);

        try {
            const goal = new GoalLookAtBlock(leafBlock.position, bot.world, { reach: 4 });
            await bot.pathfinder.goto(goal);
            await bot.dig(leafBlock);
            await sleep(100);
            return 'success';
        } catch {
            // Try from current position
            const dist = bot.entity.position.distanceTo(leafBlock.position);
            if (dist < 5) {
                try {
                    await bot.dig(leafBlock);
                    return 'success';
                } catch {
                    // Skip this leaf
                }
            }
            // Move on after a few failures
            this.currentTree.phase = 'replanting';
            return 'success';
        }
    }

    private async replantSapling(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!this.currentTree) return 'failure';

        const saplingName = SAPLING_MAP[this.currentTree.logType];
        if (!saplingName) {
            this.currentTree.phase = 'done';
            return 'success';
        }

        // Check if we have the right sapling
        const sapling = bot.inventory.items().find(i => i.name === saplingName);
        if (!sapling) {
            console.log(`[BT] No ${saplingName} to replant`);
            this.currentTree.phase = 'done';
            return 'success';
        }

        // Find a suitable spot near the original tree base
        const basePos = this.currentTree.basePos;
        let plantSpot: Vec3 | null = null;

        // Check the original position first, then nearby spots
        const offsets: [number, number][] = [
            [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [-1, 1], [1, -1], [-1, -1]
        ];

        for (const [dx, dz] of offsets) {
            const checkPos = basePos.offset(dx, 0, dz);
            const groundBlock = bot.blockAt(checkPos.offset(0, -1, 0));
            const surfaceBlock = bot.blockAt(checkPos);

            if (groundBlock &&
                ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt'].includes(groundBlock.name) &&
                surfaceBlock &&
                surfaceBlock.name === 'air') {
                plantSpot = checkPos;
                break;
            }
        }

        if (!plantSpot) {
            console.log(`[BT] No suitable spot to replant sapling`);
            this.currentTree.phase = 'done';
            return 'success';
        }

        console.log(`[BT] Replanting ${saplingName} at ${plantSpot}`);

        try {
            // Move close to the planting spot
            await bot.pathfinder.goto(new GoalNear(plantSpot.x, plantSpot.y, plantSpot.z, 3));

            // Equip and place the sapling
            await bot.equip(sapling, 'hand');
            const groundBlock = bot.blockAt(plantSpot.offset(0, -1, 0));
            if (groundBlock) {
                await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                console.log(`[BT] Sapling replanted!`);
            }
        } catch (err) {
            console.log(`[BT] Failed to replant sapling: ${err}`);
        }

        this.currentTree.phase = 'done';
        return 'success';
    }
}
