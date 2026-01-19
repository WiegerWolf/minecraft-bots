import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Logger } from './logger';

// ============================================================================
// Types
// ============================================================================

export interface StuckDetectionConfig {
    checkIntervalMs: number;        // How often to sample position (default: 500ms)
    minProgressPerSecond: number;   // Minimum progress in blocks/sec (default: 0.5)
    stuckTimeThresholdMs: number;   // Time with no progress before considered stuck (default: 3000ms)
    maxRecoveryAttempts: number;    // Max recovery attempts before giving up (default: 3)
    debug: boolean;                 // Enable debug logging (default: false)
}

export interface PathfindingResult {
    success: boolean;
    failureReason?: 'timeout' | 'stuck' | 'unreachable' | 'goal_changed';
    recoveryAttempts: number;
    finalDistanceToGoal: number;
    elapsedMs: number;
}

interface PositionSample {
    timestamp: number;
    distanceToGoal: number;
}

const DEFAULT_STUCK_CONFIG: StuckDetectionConfig = {
    checkIntervalMs: 500,
    minProgressPerSecond: 0.1,  // Very lenient - almost any movement counts
    stuckTimeThresholdMs: 8000, // 8 seconds of no progress before stuck
    maxRecoveryAttempts: 0,     // Disabled - just timeout, no recovery actions
    debug: false,
};

const RECOVERY_ACTIONS = ['jump', 'sprint_jump', 'look_around', 'clear_path', 'back_out'] as const;
type RecoveryAction = typeof RECOVERY_ACTIONS[number];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate distance to a goal, handling different goal types.
 */
export function getDistanceToGoal(pos: Vec3, goal: any): number {
    // GoalNear, GoalBlock, GoalXZ - have x, y, z properties
    if ('x' in goal && 'z' in goal) {
        const y = 'y' in goal ? goal.y : pos.y;
        const targetPos = new Vec3(goal.x, y, goal.z);
        const dist = pos.distanceTo(targetPos);

        // GoalNear has a range property - we only need to get within range
        if ('range' in goal && typeof goal.range === 'number') {
            return Math.max(0, dist - goal.range);
        }

        // GoalXZ ignores Y
        if (!('y' in goal)) {
            return pos.xzDistanceTo(targetPos);
        }

        return dist;
    }

    // GoalLookAtBlock has a pos property
    if ('pos' in goal && goal.pos) {
        return pos.distanceTo(goal.pos);
    }

    // GoalFollow has an entity with position
    if ('entity' in goal && goal.entity?.position) {
        return pos.distanceTo(goal.entity.position);
    }

    // Fallback to heuristic if available
    if (typeof goal.heuristic === 'function') {
        const node = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
        return goal.heuristic(node);
    }

    return Infinity;
}

/**
 * Check if the bot is making sufficient progress toward the goal.
 */
function isStuck(samples: PositionSample[], config: StuckDetectionConfig): boolean {
    if (samples.length < 2) return false;

    const oldestSample = samples[0]!;
    const newestSample = samples[samples.length - 1]!;
    const elapsedMs = newestSample.timestamp - oldestSample.timestamp;

    // Need enough samples to judge
    if (elapsedMs < config.stuckTimeThresholdMs) return false;

    const distanceProgress = oldestSample.distanceToGoal - newestSample.distanceToGoal;
    const progressRate = distanceProgress / (elapsedMs / 1000); // blocks/sec

    return progressRate < config.minProgressPerSecond;
}

/**
 * Attempt a recovery action to free a stuck bot.
 */
async function attemptRecovery(bot: Bot, action: RecoveryAction, debug: boolean, log?: Logger | null): Promise<boolean> {
    if (debug) {
        log?.debug({ action }, 'Attempting recovery');
    }

    try {
        switch (action) {
            case 'jump':
                bot.setControlState('jump', true);
                await sleep(200);
                bot.setControlState('jump', false);
                await sleep(100);
                return true;

            case 'sprint_jump':
                // Jump while sprinting in a random direction
                const yaw = Math.random() * Math.PI * 2;
                await bot.look(yaw, 0);
                bot.setControlState('forward', true);
                bot.setControlState('sprint', true);
                bot.setControlState('jump', true);
                await sleep(500);
                bot.clearControlStates();
                await sleep(200);
                return true;

            case 'look_around':
                // Look in different directions to help pathfinder recalculate
                for (let i = 0; i < 4; i++) {
                    await bot.look(bot.entity.yaw + Math.PI / 2, 0);
                    await sleep(100);
                }
                return true;

            case 'clear_path':
                await clearPath(bot, log);
                await sleep(300);
                return true;

            case 'back_out':
                // Move backward and jump
                bot.setControlState('back', true);
                bot.setControlState('jump', true);
                await sleep(400);
                bot.clearControlStates();
                await sleep(200);
                return true;

            default:
                return false;
        }
    } catch (err) {
        if (debug) {
            log?.debug({ action, err }, 'Recovery action failed');
        }
        return false;
    }
}

// ============================================================================
// Main Smart Pathfinding Function
// ============================================================================

/**
 * Extract target position from various goal types.
 */
function getGoalPosition(goal: any): Vec3 | null {
    if ('x' in goal && 'z' in goal) {
        const y = 'y' in goal ? goal.y : 64;
        return new Vec3(goal.x, y, goal.z);
    }
    if ('pos' in goal && goal.pos) {
        return goal.pos.clone();
    }
    if ('entity' in goal && goal.entity?.position) {
        return goal.entity.position.clone();
    }
    return null;
}

/**
 * Simple pathfinding with timeout only, no recovery.
 */
async function pathfindWithTimeout(
    bot: Bot,
    goal: any,
    timeoutMs: number
): Promise<{ success: boolean; error?: Error }> {
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            try { bot.pathfinder.stop(); } catch { /* ignore */ }
            reject(new Error('Pathfinding timed out'));
        }, timeoutMs);
    });

    try {
        await Promise.race([bot.pathfinder.goto(goal), timeoutPromise]);
        clearTimeout(timeoutId!);
        return { success: true };
    } catch (err) {
        clearTimeout(timeoutId!);
        return {
            success: false,
            error: err instanceof Error ? err : new Error(String(err))
        };
    }
}

/**
 * Walk in a direction for a short distance using controls (no pathfinding).
 */
async function walkDirection(bot: Bot, direction: Vec3, blocks: number): Promise<void> {
    const yaw = Math.atan2(-direction.x, -direction.z);
    await bot.look(yaw, 0);

    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);

    // Estimate time: ~5.6 blocks/sec sprinting
    const walkTimeMs = (blocks / 5.6) * 1000;
    await sleep(Math.min(walkTimeMs, 2000)); // Cap at 2 seconds

    bot.clearControlStates();
    await sleep(100);
}

/**
 * Smart pathfinding wrapper with timeout and optional knight's move recovery.
 *
 * When direct pathfinding fails and knightMoveRecovery is enabled, attempts recovery by:
 * 1. Backing out (walking opposite direction)
 * 2. Approaching from an angle (knight's move - L-shaped path)
 *
 * Note: knightMoveRecovery defaults to FALSE because it causes disruptive L-shaped
 * movements even on transient failures. Only enable it for situations where the bot
 * is likely to be physically stuck (e.g., exploration in tight spaces).
 */
export async function smartPathfinderGoto(
    bot: Bot,
    goal: any,
    options?: {
        timeoutMs?: number;
        stuckDetection?: Partial<StuckDetectionConfig>;  // Kept for API compatibility
        knightMoveRecovery?: boolean;  // Enable knight's move recovery (default: false)
        debug?: boolean;
        logger?: Logger | null;
    }
): Promise<PathfindingResult> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const knightMoveRecovery = options?.knightMoveRecovery ?? false;
    const debug = options?.debug ?? false;
    const log = options?.logger;
    const startTime = Date.now();

    // First attempt: direct pathfinding
    const directResult = await pathfindWithTimeout(bot, goal, timeoutMs);

    if (directResult.success) {
        return {
            success: true,
            recoveryAttempts: 0,
            finalDistanceToGoal: getDistanceToGoal(bot.entity.position, goal),
            elapsedMs: Date.now() - startTime,
        };
    }

    // Check if we should attempt recovery
    const error = directResult.error;
    const isTimeout = error?.message.includes('timed out');
    const isUnreachable = error?.message.includes('no path') ||
                          error?.message.includes('No path') ||
                          error?.message.includes('Path was stopped');

    // Don't recover from goal_changed errors
    if (error && isGoalChangedError(error)) {
        return {
            success: false,
            failureReason: 'goal_changed',
            recoveryAttempts: 0,
            finalDistanceToGoal: getDistanceToGoal(bot.entity.position, goal),
            elapsedMs: Date.now() - startTime,
        };
    }

    // Skip recovery if disabled or if we're already close enough
    const currentDist = getDistanceToGoal(bot.entity.position, goal);
    if (!knightMoveRecovery || currentDist < 3) {
        return {
            success: false,
            failureReason: isTimeout ? 'timeout' : 'unreachable',
            recoveryAttempts: 0,
            finalDistanceToGoal: currentDist,
            elapsedMs: Date.now() - startTime,
        };
    }

    // Get goal position for recovery calculations
    const goalPos = getGoalPosition(goal);
    if (!goalPos) {
        return {
            success: false,
            failureReason: isTimeout ? 'timeout' : 'unreachable',
            recoveryAttempts: 0,
            finalDistanceToGoal: currentDist,
            elapsedMs: Date.now() - startTime,
        };
    }

    // ========================================================================
    // Knight's Move Recovery
    // ========================================================================
    if (debug) log?.debug('Direct path failed, attempting knight\'s move recovery');

    const botPos = bot.entity.position;
    const toGoal = goalPos.minus(botPos);
    const distToGoal = toGoal.norm();

    // Step 1: Back out - walk opposite direction
    if (debug) log?.debug('Step 1: Backing out');
    const backDirection = toGoal.scaled(-1 / distToGoal); // Normalize and reverse
    await walkDirection(bot, backDirection, 4);

    // Step 2: Move perpendicular (knight's move setup)
    // Calculate perpendicular direction (rotate 90 degrees on XZ plane)
    const perpendicular = new Vec3(-toGoal.z, 0, toGoal.x).normalize();
    // Randomly pick left or right
    const sideDirection = Math.random() > 0.5 ? perpendicular : perpendicular.scaled(-1);

    if (debug) log?.debug('Step 2: Moving sideways');
    await walkDirection(bot, sideDirection, 5);

    // Step 3: Try pathfinding again from new position
    if (debug) log?.debug('Step 3: Attempting path from new angle');
    const recoveryTimeoutMs = Math.max(timeoutMs - (Date.now() - startTime), 5000);
    const recoveryResult = await pathfindWithTimeout(bot, goal, recoveryTimeoutMs);

    const finalDistance = getDistanceToGoal(bot.entity.position, goal);
    const elapsedMs = Date.now() - startTime;

    if (recoveryResult.success) {
        if (debug) log?.debug('Knight\'s move recovery succeeded');
        return {
            success: true,
            recoveryAttempts: 1,
            finalDistanceToGoal: finalDistance,
            elapsedMs,
        };
    }

    // Recovery failed - check if we at least got closer
    if (finalDistance < currentDist * 0.7) {
        if (debug) log?.debug({ fromDist: currentDist.toFixed(1), toDist: finalDistance.toFixed(1) }, 'Recovery partial success - got closer');
        // Consider it a success if we got significantly closer
        return {
            success: true,
            recoveryAttempts: 1,
            finalDistanceToGoal: finalDistance,
            elapsedMs,
        };
    }

    if (debug) log?.debug('Knight\'s move recovery failed');
    return {
        success: false,
        failureReason: isTimeout ? 'timeout' : 'unreachable',
        recoveryAttempts: 1,
        finalDistanceToGoal: finalDistance,
        elapsedMs,
    };
}

// ============================================================================
// Legacy Functions (Backward Compatible)
// ============================================================================

/**
 * Wrapper for bot.pathfinder.goto() that adds timeout functionality.
 * If pathfinding doesn't complete within the specified time, it will be canceled.
 *
 * @deprecated Use smartPathfinderGoto() for better stuck detection
 */
export async function pathfinderGotoWithTimeout(
    bot: Bot,
    goal: any,
    timeoutMs: number = 5000 // Default 5 seconds
): Promise<void> {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            bot.pathfinder.stop();
            reject(new Error(`Pathfinding timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    const pathfindingPromise = bot.pathfinder.goto(goal);

    return Promise.race([pathfindingPromise, timeoutPromise]) as Promise<void>;
}

/**
 * Attempts to clear a path by breaking nearby blocks that might be obstructing the bot.
 */
export async function clearPath(bot: Bot, log?: Logger | null): Promise<void> {
    // Check for blocks around the bot that might be obstructing movement
    const searchPositions = [
        { x: 0, y: 0, z: 1 },  // Front
        { x: 0, y: 1, z: 1 },  // Front upper
        { x: 1, y: 0, z: 0 },  // Right
        { x: 1, y: 1, z: 0 },  // Right upper
        { x: 0, y: 0, z: -1 }, // Back
        { x: 0, y: 1, z: -1 }, // Back upper
        { x: -1, y: 0, z: 0 }, // Left
        { x: -1, y: 1, z: 0 }, // Left upper
        { x: 0, y: 2, z: 0 },  // Above
    ];

    for (const offset of searchPositions) {
        const blockPos = bot.entity.position.offset(offset.x, offset.y, offset.z).floored();
        const block = bot.blockAt(blockPos);

        if (block && block.boundingBox === 'block' && block.name !== 'air') {
            try {
                // Only break blocks that are not too hard (avoid breaking stone, etc.)
                const breakableBlocks = ['dirt', 'grass', 'sand', 'gravel', 'wood', 'leaves'];
                if (breakableBlocks.some(type => block.name.includes(type))) {
                    await bot.dig(block);
                    await sleep(200);
                }
            } catch (err) {
                log?.warn({ pos: blockPos.toString(), err }, 'Failed to break block');
            }
        }
    }
}

// ============================================================================
// Hole Escape Functions
// ============================================================================

/**
 * Check if the bot is stuck in a vertical hole (1x1 or 1x2 pit).
 * Returns true if solid blocks surround the bot on all 4 horizontal sides.
 */
export function isInHole(bot: Bot): boolean {
    const pos = bot.entity.position.floored();
    const directions = [
        { x: 1, z: 0 },
        { x: -1, z: 0 },
        { x: 0, z: 1 },
        { x: 0, z: -1 },
    ];

    let blockedSides = 0;
    for (const dir of directions) {
        // Check both feet level and head level
        const feetBlock = bot.blockAt(pos.offset(dir.x, 0, dir.z));
        const headBlock = bot.blockAt(pos.offset(dir.x, 1, dir.z));

        // If either feet or head level is blocked, count as blocked
        if ((feetBlock && feetBlock.boundingBox === 'block') ||
            (headBlock && headBlock.boundingBox === 'block')) {
            blockedSides++;
        }
    }

    // Stuck if blocked on 3 or more sides
    return blockedSides >= 3;
}

/**
 * Blocks that can be broken to escape a hole.
 * Includes common terrain blocks but excludes bedrock, obsidian, etc.
 */
const ESCAPABLE_BLOCKS = [
    'dirt', 'grass_block', 'sand', 'gravel', 'clay',
    'stone', 'cobblestone', 'andesite', 'diorite', 'granite',
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
    'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
    'netherrack', 'sandstone', 'red_sandstone',
    'terracotta', 'snow_block', 'snow', 'ice', 'packed_ice',
    'moss_block', 'mud', 'muddy_mangrove_roots',
];

function canBreakToEscape(block: any): boolean {
    if (!block || block.name === 'air' || block.name === 'water' || block.name === 'lava') {
        return false;
    }
    // Check if block name matches any escapable block
    return ESCAPABLE_BLOCKS.some(name => block.name.includes(name)) ||
           block.name.includes('log') ||
           block.name.includes('leaves') ||
           block.name.includes('dirt') ||
           block.name.includes('sand');
}

/**
 * Attempt to escape from a hole by breaking blocks above and to the sides.
 * Returns true if escape was successful (bot moved to a new position).
 */
export async function escapeFromHole(bot: Bot, log?: Logger | null): Promise<boolean> {
    const startPos = bot.entity.position.clone();
    log?.info('Attempting to escape from hole');

    // Step 1: Clear space above (break blocks at y+2 and y+3 to allow jumping)
    for (let dy = 2; dy <= 3; dy++) {
        const abovePos = bot.entity.position.offset(0, dy, 0).floored();
        const aboveBlock = bot.blockAt(abovePos);

        if (aboveBlock && canBreakToEscape(aboveBlock)) {
            try {
                log?.debug({ block: aboveBlock.name, pos: abovePos.toString() }, 'Breaking block above');
                await bot.dig(aboveBlock);
                await sleep(100);
            } catch (err) {
                log?.debug({ err }, 'Failed to break block above');
            }
        }
    }

    // Step 2: Try to break blocks in each horizontal direction (create exit)
    const directions = [
        { x: 1, z: 0, name: 'east' },
        { x: -1, z: 0, name: 'west' },
        { x: 0, z: 1, name: 'south' },
        { x: 0, z: -1, name: 'north' },
    ];

    for (const dir of directions) {
        // Break blocks at feet and head level in this direction
        for (let dy = 0; dy <= 1; dy++) {
            const blockPos = bot.entity.position.offset(dir.x, dy, dir.z).floored();
            const block = bot.blockAt(blockPos);

            if (block && canBreakToEscape(block)) {
                try {
                    log?.debug({ block: block.name, pos: blockPos.toString(), dir: dir.name }, 'Breaking block to side');
                    await bot.dig(block);
                    await sleep(100);
                } catch (err) {
                    log?.debug({ err }, 'Failed to break side block');
                }
            }
        }

        // After breaking, try to walk out in this direction
        const exitPos = bot.entity.position.offset(dir.x, 0, dir.z);
        const exitFeet = bot.blockAt(exitPos.floored());
        const exitHead = bot.blockAt(exitPos.offset(0, 1, 0).floored());

        // Check if we can walk out
        if ((!exitFeet || exitFeet.name === 'air' || exitFeet.boundingBox !== 'block') &&
            (!exitHead || exitHead.name === 'air' || exitHead.boundingBox !== 'block')) {

            // Try to walk out
            log?.debug({ dir: dir.name }, 'Attempting to walk out');
            const yaw = Math.atan2(-dir.x, -dir.z);
            await bot.look(yaw, 0);

            bot.setControlState('forward', true);
            bot.setControlState('jump', true);
            await sleep(500);
            bot.clearControlStates();
            await sleep(200);

            // Check if we moved
            const newPos = bot.entity.position;
            if (newPos.distanceTo(startPos) > 0.5) {
                log?.info({ from: startPos.floored().toString(), to: newPos.floored().toString() }, 'Escaped from hole');
                return true;
            }
        }
    }

    // Step 3: If still stuck, try jumping repeatedly while breaking above
    log?.debug('Still stuck, trying jump escape');
    for (let attempt = 0; attempt < 3; attempt++) {
        // Break block above
        const abovePos = bot.entity.position.offset(0, 2, 0).floored();
        const aboveBlock = bot.blockAt(abovePos);
        if (aboveBlock && canBreakToEscape(aboveBlock)) {
            try {
                await bot.dig(aboveBlock);
            } catch { /* ignore */ }
        }

        // Jump
        bot.setControlState('jump', true);
        await sleep(400);
        bot.setControlState('jump', false);
        await sleep(200);

        // Check if we escaped
        if (bot.entity.position.distanceTo(startPos) > 1) {
            log?.info('Escaped from hole via jumping');
            return true;
        }
    }

    log?.warn('Failed to escape from hole');
    return false;
}

/**
 * Track consecutive pathfinding failures and attempt hole escape when stuck.
 */
export interface StuckTracker {
    consecutiveFailures: number;
    lastPosition: Vec3 | null;
    lastFailureTime: number;
}

export function createStuckTracker(): StuckTracker {
    return {
        consecutiveFailures: 0,
        lastPosition: null,
        lastFailureTime: 0,
    };
}

/**
 * Record a pathfinding failure and check if hole escape should be attempted.
 * Returns true if hole escape should be attempted.
 */
export function recordPathfindingFailure(
    tracker: StuckTracker,
    currentPos: Vec3,
    threshold: number = 3
): boolean {
    const now = Date.now();

    // Reset if too much time passed (bot was doing other things)
    if (now - tracker.lastFailureTime > 30000) {
        tracker.consecutiveFailures = 0;
    }

    // Check if position changed significantly since last failure
    if (tracker.lastPosition && currentPos.distanceTo(tracker.lastPosition) > 2) {
        // Bot moved, reset counter
        tracker.consecutiveFailures = 0;
    }

    tracker.consecutiveFailures++;
    tracker.lastPosition = currentPos.clone();
    tracker.lastFailureTime = now;

    return tracker.consecutiveFailures >= threshold;
}

/**
 * Reset the stuck tracker after successful movement or escape.
 */
export function resetStuckTracker(tracker: StuckTracker): void {
    tracker.consecutiveFailures = 0;
    tracker.lastPosition = null;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a pathfinder "goal changed" error.
 * This happens when a new goal interrupts an existing pathfinding operation.
 */
export function isGoalChangedError(err: unknown): boolean {
    if (err instanceof Error) {
        return err.message.includes('goal was changed') || err.name === 'GoalChanged';
    }
    return false;
}

/**
 * Check if an error is a pathfinder timeout error.
 */
export function isPathfinderTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
        return err.message.includes('Pathfinding timed out');
    }
    return false;
}

/**
 * Wrapper for pathfinding with retry logic and path clearing on timeout.
 *
 * @deprecated Use smartPathfinderGoto() for better stuck detection
 */
export async function pathfinderGotoWithRetry(
    bot: Bot,
    goal: any,
    maxRetries: number = 2,
    timeoutMs: number = 5000,
    log?: Logger | null
): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            log?.debug({ attempt: attempt + 1, maxRetries: maxRetries + 1 }, 'Pathfinding attempt');
            await pathfinderGotoWithTimeout(bot, goal, timeoutMs);
            return true; // Success
        } catch (err) {
            log?.debug({ attempt: attempt + 1, err }, 'Pathfinding attempt failed');

            // If this was a timeout, try to clear path before retrying
            if (isPathfinderTimeoutError(err) && attempt < maxRetries) {
                log?.debug('Pathfinding timed out, attempting to clear path');
                await clearPath(bot, log);
                await sleep(1000); // Wait for dust to settle
            }

            // If we've reached max retries, give up
            if (attempt === maxRetries) {
                log?.warn('All pathfinding attempts failed');
                return false;
            }
        }
    }
    return false; // Should never reach here
}
