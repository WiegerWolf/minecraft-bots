import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { pathfinderGotoWithRetry } from '../farming/behaviors/actions/utils';

const { GoalNear, GoalLookAtBlock } = goals;

// Tree-related block names
export const LOG_NAMES = [
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
    'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'
];

export const LEAF_NAMES = [
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
    'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
    'azalea_leaves', 'flowering_azalea_leaves'
];

export const SAPLING_MAP: Record<string, string> = {
    'oak_log': 'oak_sapling',
    'birch_log': 'birch_sapling',
    'spruce_log': 'spruce_sapling',
    'jungle_log': 'jungle_sapling',
    'acacia_log': 'acacia_sapling',
    'dark_oak_log': 'dark_oak_sapling',
    'mangrove_log': 'mangrove_propagule',
    'cherry_log': 'cherry_sapling',
};

export const SAPLING_NAMES = Object.values(SAPLING_MAP);

// Blocks that can be cleared to make room for sapling
export const CLEARABLE_VEGETATION = [
    'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
    'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
    'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
    'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
    'dead_bush', 'sweet_berry_bush'
];

export interface TreeHarvestState {
    basePos: Vec3;
    logType: string;
    phase: 'chopping' | 'clearing_leaves' | 'replanting' | 'done';
    /**
     * Flag to prevent re-entry during async operations (pathfinding, digging).
     * When true, subsequent calls to continueTreeHarvest should return 'success'
     * immediately without starting new operations.
     */
    busy?: boolean;
}

export type TreeHarvestResult = 'success' | 'failure' | 'done';

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find a tree to harvest near the given position
 */
export function findTree(bot: Bot, maxDistance: number = 32): Block | null {
    const logs = bot.findBlocks({
        matching: b => LOG_NAMES.includes(b.name),
        maxDistance,
        count: 10
    });

    if (logs.length === 0) return null;

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

    return baseLog;
}

/**
 * Chop logs from a tree
 */
export async function chopLogs(bot: Bot, state: TreeHarvestState): Promise<TreeHarvestResult> {
    // Find remaining logs in a column above the base
    const baseX = Math.floor(state.basePos.x);
    const baseZ = Math.floor(state.basePos.z);

    // Equip axe if available
    const axe = bot.inventory.items().find(i => i.name.includes('axe'));
    if (axe) {
        try {
            await bot.equip(axe, 'hand');
        } catch (err) {
            console.log(`[TreeHarvest] Failed to equip axe: ${err}`);
        }
    }

    for (let dy = 0; dy < 20; dy++) {
        const y = Math.floor(state.basePos.y) + dy;
        const block = bot.blockAt(new Vec3(baseX, y, baseZ));

        if (block && LOG_NAMES.includes(block.name)) {
            // Check if reachable
            if (block.position.y > bot.entity.position.y + 4) {
                // Too high, move to clearing leaves
                break;
            }

            console.log(`[TreeHarvest] Chopping ${block.name} at ${block.position}`);

            // Mark as busy before starting async operations
            state.busy = true;
            try {
                const goal = new GoalLookAtBlock(block.position, bot.world, { reach: 4 });
                const success = await pathfinderGotoWithRetry(bot, goal);
                if (!success) {
                    console.log(`[TreeHarvest] Failed to reach log after retries`);
                    state.busy = false;
                    break;
                }
                await bot.dig(block);
                await sleep(150);
                state.busy = false;
                return 'success';
            } catch {
                state.busy = false;
                // Try from current position if close
                const dist = bot.entity.position.distanceTo(block.position);
                if (dist < 5) {
                    try {
                        await bot.dig(block);
                        return 'success';
                    } catch {
                        break;
                    }
                }
                break;
            }
        }
    }

    // No more logs in column, move to clearing leaves
    console.log(`[TreeHarvest] Tree trunk cleared, removing leaves...`);
    state.phase = 'clearing_leaves';
    return 'success';
}

/**
 * Clear leaves around a harvested tree
 */
export async function clearLeaves(bot: Bot, state: TreeHarvestState): Promise<TreeHarvestResult> {
    // Find leaves near where the tree was - search higher up where the canopy was
    const searchCenter = state.basePos.offset(0, 5, 0);

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
        console.log(`[TreeHarvest] Leaves cleared, checking for sapling to replant...`);
        state.phase = 'replanting';
        return 'success';
    }

    const leafData = sortedLeaves[0];
    if (!leafData) {
        state.phase = 'replanting';
        return 'success';
    }

    const leafBlock = bot.blockAt(leafData.pos);
    if (!leafBlock) {
        state.phase = 'replanting';
        return 'success';
    }

    console.log(`[TreeHarvest] Breaking leaves at ${leafBlock.position}`);

    // Mark as busy before starting async operations
    state.busy = true;
    try {
        const goal = new GoalLookAtBlock(leafBlock.position, bot.world, { reach: 5 });
        const success = await pathfinderGotoWithRetry(bot, goal);
        if (!success) {
            console.log(`[TreeHarvest] Failed to reach leaf after retries`);
            state.phase = 'replanting';
            state.busy = false;
            return 'success';
        }
        await bot.dig(leafBlock);
        await sleep(100);
        state.busy = false;
        return 'success';
    } catch {
        state.busy = false;
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
        state.phase = 'replanting';
        return 'success';
    }
}

/**
 * Replant saplings after harvesting
 * Returns the number of saplings planted
 */
export async function replantSapling(
    bot: Bot,
    state: TreeHarvestState,
    plantedPositions: Vec3[],
    saplingSpacing: number = 5
): Promise<{ result: TreeHarvestResult; planted: boolean }> {
    const saplingName = SAPLING_MAP[state.logType];
    if (!saplingName) {
        state.phase = 'done';
        return { result: 'done', planted: false };
    }

    // Check if we have any saplings left to plant
    const sapling = bot.inventory.items().find(i => i.name === saplingName);
    if (!sapling) {
        if (plantedPositions.length > 0) {
            console.log(`[TreeHarvest] Finished planting ${plantedPositions.length} saplings`);
        } else {
            console.log(`[TreeHarvest] No ${saplingName} to replant`);
        }
        state.phase = 'done';
        return { result: 'done', planted: false };
    }

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

        // Check spacing from saplings we just planted in this session
        const tooCloseToPlanted = plantedPositions.some(
            planted => planted.distanceTo(surfacePos) < saplingSpacing
        );
        if (tooCloseToPlanted) continue;

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
        if (plantedPositions.length > 0) {
            console.log(`[TreeHarvest] Finished planting ${plantedPositions.length} saplings (no more suitable spots)`);
        } else {
            console.log(`[TreeHarvest] No suitable spot to replant sapling`);
        }
        state.phase = 'done';
        return { result: 'done', planted: false };
    }

    // Mark as busy before starting async operations
    state.busy = true;
    try {
        // Move close to the planting spot
        const success = await pathfinderGotoWithRetry(bot, new GoalNear(plantSpot.x, plantSpot.y, plantSpot.z, 3));
        if (!success) {
            console.log(`[TreeHarvest] Failed to reach planting spot after retries`);
            state.busy = false;
            return { result: 'success', planted: false };
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
            plantedPositions.push(plantSpot.clone());
            console.log(`[TreeHarvest] Planted sapling ${plantedPositions.length} at ${plantSpot}`);
            state.busy = false;
            return { result: 'success', planted: true };
        }
        state.busy = false;
    } catch (err) {
        state.busy = false;
        console.log(`[TreeHarvest] Failed to plant sapling: ${err}`);
    }

    // Stay in replanting phase to plant more saplings
    return { result: 'success', planted: false };
}

/**
 * Continue harvesting a tree based on current phase
 */
export async function continueTreeHarvest(
    bot: Bot,
    state: TreeHarvestState,
    plantedPositions: Vec3[]
): Promise<TreeHarvestResult> {
    // Prevent re-entry during async operations (pathfinding, digging)
    // This is critical because the GOAP executor calls this every tick
    if (state.busy) {
        return 'success'; // Still working, don't start new operations
    }

    switch (state.phase) {
        case 'chopping':
            return chopLogs(bot, state);
        case 'clearing_leaves':
            return clearLeaves(bot, state);
        case 'replanting':
            const { result } = await replantSapling(bot, state, plantedPositions);
            return result;
        case 'done':
            return 'done';
    }
}

/**
 * Start harvesting a new tree
 */
export function startTreeHarvest(bot: Bot, maxDistance: number = 32): TreeHarvestState | null {
    const baseLog = findTree(bot, maxDistance);
    if (!baseLog) return null;

    console.log(`[TreeHarvest] Starting to harvest ${baseLog.name.replace('_log', '')} tree at ${baseLog.position}`);

    return {
        basePos: baseLog.position.clone(),
        logType: baseLog.name,
        phase: 'chopping'
    };
}
