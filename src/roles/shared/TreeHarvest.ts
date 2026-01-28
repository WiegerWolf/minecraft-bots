import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { GoalNear, GoalGetToBlock } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../shared/PathfindingUtils';
import type { Logger } from '../../shared/logger';

// Module-level logger reference (set by caller)
let moduleLog: Logger | null = null;

export function setTreeHarvestLogger(logger: Logger | null): void {
    moduleLog = logger;
}

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

// Map log types to their corresponding leaf types
// Used to verify a log is part of a real tree (has matching leaves attached)
export const LOG_TO_LEAF_MAP: Record<string, string[]> = {
    'oak_log': ['oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves'],
    'birch_log': ['birch_leaves'],
    'spruce_log': ['spruce_leaves'],
    'jungle_log': ['jungle_leaves'],
    'acacia_log': ['acacia_leaves'],
    'dark_oak_log': ['dark_oak_leaves'],
    'mangrove_log': ['mangrove_leaves'],
    'cherry_log': ['cherry_leaves'],
};

export const SAPLING_NAMES = Object.values(SAPLING_MAP);

// Max consecutive pathfinding failures before giving up on replanting
const MAX_REPLANT_FAILURES = 3;

// Minimum distance from farmland to avoid planting saplings
// Trees can block sunlight and drop leaves on crops
const MIN_FARM_DISTANCE = 10;

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
    /**
     * Track consecutive pathfinding failures in replanting phase.
     * After MAX_REPLANT_FAILURES, give up and mark harvest as done.
     */
    replantFailures?: number;
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
            moduleLog?.warn({ err }, 'Failed to equip axe');
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

            moduleLog?.debug({ block: block.name, pos: block.position.toString() }, 'Chopping log');

            // Mark as busy before starting async operations
            state.busy = true;
            try {
                const goal = new GoalGetToBlock(block.position.x, block.position.y, block.position.z);
                const result = await smartPathfinderGoto(bot, goal, { timeoutMs: 10000 });
                if (!result.success) {
                    moduleLog?.warn({ reason: result.failureReason }, 'Failed to reach log');
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
    moduleLog?.debug('Tree trunk cleared, removing leaves');
    state.phase = 'clearing_leaves';
    return 'success';
}

/**
 * Find all leaves reachable from current position (within dig range)
 */
function findReachableLeavesFromPosition(bot: Bot, searchCenter: Vec3): Vec3[] {
    const leaves = bot.findBlocks({
        point: searchCenter,
        maxDistance: 7,
        count: 50,
        matching: b => LEAF_NAMES.includes(b.name)
    });

    const botPos = bot.entity.position;
    const reachable: Vec3[] = [];

    for (const pos of leaves) {
        const dist = botPos.distanceTo(pos);
        const heightAbove = pos.y - botPos.y;

        // Can reach blocks within ~4.5 blocks and up to 5 blocks above
        if (dist <= 4.5 && heightAbove <= 5 && heightAbove >= -2) {
            reachable.push(pos);
        }
    }

    // Sort by height (lower first) to clear systematically
    return reachable.sort((a, b) => a.y - b.y);
}

/**
 * Clear leaves around a harvested tree
 * Prioritizes breaking all reachable leaves from current position before moving
 */
export async function clearLeaves(bot: Bot, state: TreeHarvestState): Promise<TreeHarvestResult> {
    // Find leaves near where the tree was - search higher up where the canopy was
    const searchCenter = state.basePos.offset(0, 5, 0);

    // First, try to break any leaves reachable from current position
    const reachableFromHere = findReachableLeavesFromPosition(bot, searchCenter);

    if (reachableFromHere.length > 0) {
        // Break all reachable leaves from current position before moving
        state.busy = true;
        let brokenCount = 0;

        for (const leafPos of reachableFromHere) {
            const leafBlock = bot.blockAt(leafPos);
            if (!leafBlock || !LEAF_NAMES.includes(leafBlock.name)) continue;

            try {
                await bot.dig(leafBlock);
                brokenCount++;
                await sleep(50); // Small delay between breaks
            } catch {
                // Skip this leaf if we can't break it
                continue;
            }
        }

        state.busy = false;

        if (brokenCount > 0) {
            moduleLog?.debug({ count: brokenCount }, 'Broke leaves from current position');
            return 'success';
        }
    }

    // No leaves reachable from here - find leaves that need movement
    const allLeaves = bot.findBlocks({
        point: searchCenter,
        maxDistance: 7,
        count: 50,
        matching: b => LEAF_NAMES.includes(b.name)
    });

    // Filter to leaves we can potentially reach (not too high)
    const reachableLeaves = allLeaves
        .map(pos => ({
            pos,
            dist: bot.entity.position.distanceTo(pos),
            heightAbove: pos.y - bot.entity.position.y
        }))
        .filter(l => l.heightAbove <= 5 && l.heightAbove >= -2);

    if (reachableLeaves.length === 0) {
        // No more reachable leaves, move to replanting
        moduleLog?.debug('Leaves cleared, checking for sapling to replant');
        state.phase = 'replanting';
        return 'success';
    }

    // Find the best position to move to (position that can reach the most leaves)
    // Group leaves by potential standing positions
    const leafData = reachableLeaves[0];
    if (!leafData) {
        state.phase = 'replanting';
        return 'success';
    }

    const leafBlock = bot.blockAt(leafData.pos);
    if (!leafBlock) {
        state.phase = 'replanting';
        return 'success';
    }

    moduleLog?.debug({ pos: leafBlock.position.toString() }, 'Moving to break more leaves');

    // Mark as busy before starting async operations
    state.busy = true;
    try {
        const goal = new GoalGetToBlock(leafBlock.position.x, leafBlock.position.y, leafBlock.position.z);
        const result = await smartPathfinderGoto(bot, goal, { timeoutMs: 10000 });
        if (!result.success) {
            moduleLog?.warn({ reason: result.failureReason }, 'Failed to reach leaf');
            state.phase = 'replanting';
            state.busy = false;
            return 'success';
        }
        // Don't break the leaf here - let the next tick break all reachable leaves
        state.busy = false;
        return 'success';
    } catch {
        state.busy = false;
        // Move on after failure
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
            moduleLog?.info({ count: plantedPositions.length }, 'Finished planting saplings');
        } else {
            moduleLog?.debug({ sapling: saplingName }, 'No saplings to replant');
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

        // Avoid planting near farmland (trees can block sunlight and drop leaves on crops)
        const nearbyFarmland = bot.findBlocks({
            point: surfacePos,
            maxDistance: MIN_FARM_DISTANCE - 1,
            count: 1,
            matching: b => b.name === 'farmland' || b.name === 'water'
        });
        if (nearbyFarmland.length > 0) continue;

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
            moduleLog?.info({ count: plantedPositions.length }, 'Finished planting saplings (no more spots)');
        } else {
            moduleLog?.debug('No suitable spot to replant sapling');
        }
        state.phase = 'done';
        return { result: 'done', planted: false };
    }

    // Mark as busy before starting async operations
    state.busy = true;
    try {
        // Move close to the planting spot
        const result = await smartPathfinderGoto(bot, new GoalNear(plantSpot.x, plantSpot.y, plantSpot.z, 3), { timeoutMs: 10000 });
        if (!result.success) {
            state.replantFailures = (state.replantFailures || 0) + 1;
            moduleLog?.warn({ failures: state.replantFailures, max: MAX_REPLANT_FAILURES, reason: result.failureReason }, 'Failed to reach planting spot');
            state.busy = false;

            // Give up after too many consecutive failures (likely stuck in a hole)
            if (state.replantFailures >= MAX_REPLANT_FAILURES) {
                moduleLog?.warn('Too many pathfinding failures, giving up on replanting');
                state.phase = 'done';
                return { result: 'done', planted: false };
            }
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
            moduleLog?.info({ count: plantedPositions.length, pos: plantSpot.toString() }, 'Planted sapling');
            state.replantFailures = 0; // Reset on success
            state.busy = false;
            return { result: 'success', planted: true };
        }
        state.busy = false;
    } catch (err) {
        state.busy = false;
        state.replantFailures = (state.replantFailures || 0) + 1;
        moduleLog?.warn({ err, failures: state.replantFailures }, 'Failed to plant sapling');

        // Give up after too many consecutive failures
        if (state.replantFailures >= MAX_REPLANT_FAILURES) {
            moduleLog?.warn('Too many planting failures, giving up on replanting');
            state.phase = 'done';
            return { result: 'done', planted: false };
        }
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

    const treeType = baseLog.name.replace('_log', '');
    moduleLog?.info({ treeType, pos: baseLog.position.toString() }, 'Starting tree harvest');

    return {
        basePos: baseLog.position.clone(),
        logType: baseLog.name,
        phase: 'chopping'
    };
}
