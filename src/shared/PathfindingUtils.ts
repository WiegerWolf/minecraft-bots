import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

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
    minProgressPerSecond: 0.5,
    stuckTimeThresholdMs: 3000,
    maxRecoveryAttempts: 3,
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
async function attemptRecovery(bot: Bot, action: RecoveryAction, debug: boolean): Promise<boolean> {
    if (debug) {
        console.log(`[Pathfinder] Attempting recovery: ${action}`);
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
                await clearPath(bot);
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
            console.log(`[Pathfinder] Recovery action ${action} failed: ${err}`);
        }
        return false;
    }
}

// ============================================================================
// Main Smart Pathfinding Function
// ============================================================================

/**
 * Smart pathfinding wrapper with stuck detection and recovery.
 *
 * Monitors progress toward the goal and detects when the bot is stuck.
 * When stuck, attempts various recovery actions before giving up.
 */
export async function smartPathfinderGoto(
    bot: Bot,
    goal: any,
    options?: {
        timeoutMs?: number;
        stuckDetection?: Partial<StuckDetectionConfig>;
    }
): Promise<PathfindingResult> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const config: StuckDetectionConfig = {
        ...DEFAULT_STUCK_CONFIG,
        ...options?.stuckDetection,
    };

    const startTime = Date.now();
    let recoveryAttempts = 0;
    let recoveryActionIndex = 0;

    const initialDistance = getDistanceToGoal(bot.entity.position, goal);

    if (config.debug) {
        console.log(`[Pathfinder] Starting pathfinding, distance: ${initialDistance.toFixed(2)} blocks`);
    }

    while (true) {
        const samples: PositionSample[] = [];
        let pathfindingComplete = false;
        let pathfindingError: Error | null = null;
        let monitorInterval: ReturnType<typeof setInterval> | null = null;

        // Start monitoring progress
        const monitorPromise = new Promise<'stuck' | 'timeout' | 'complete' | 'error'>((resolve) => {
            monitorInterval = setInterval(() => {
                const currentDistance = getDistanceToGoal(bot.entity.position, goal);
                samples.push({ timestamp: Date.now(), distanceToGoal: currentDistance });

                // Keep only samples within the threshold window (plus a bit extra)
                const cutoffTime = Date.now() - config.stuckTimeThresholdMs - config.checkIntervalMs;
                while (samples.length > 0 && samples[0]!.timestamp < cutoffTime) {
                    samples.shift();
                }

                if (config.debug && samples.length > 0) {
                    const firstSample = samples[0]!;
                    const progress = samples.length > 1
                        ? ((firstSample.distanceToGoal - currentDistance) / ((Date.now() - firstSample.timestamp) / 1000)).toFixed(2)
                        : '---';
                    console.log(`[Pathfinder] Distance: ${currentDistance.toFixed(2)}, Progress rate: ${progress} blocks/sec`);
                }

                // Check timeout
                if (Date.now() - startTime > timeoutMs) {
                    resolve('timeout');
                    return;
                }

                // Check if stuck
                if (isStuck(samples, config)) {
                    resolve('stuck');
                    return;
                }

                // Check if pathfinding completed
                if (pathfindingComplete) {
                    resolve('complete');
                } else if (pathfindingError) {
                    resolve('error');
                }
            }, config.checkIntervalMs);
        });

        // Start pathfinding
        const pathfindingPromise = bot.pathfinder.goto(goal)
            .then(() => { pathfindingComplete = true; })
            .catch((err: Error) => { pathfindingError = err; });

        // Wait for either pathfinding to complete, stuck detection, or timeout
        const result = await monitorPromise;

        // Cleanup
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }
        bot.pathfinder.stop();
        bot.clearControlStates();

        // Wait for pathfinding promise to settle
        await pathfindingPromise.catch(() => {});

        const finalDistance = getDistanceToGoal(bot.entity.position, goal);
        const elapsedMs = Date.now() - startTime;

        if (result === 'complete' || finalDistance < 0.5) {
            if (config.debug) {
                console.log(`[Pathfinder] Success! Final distance: ${finalDistance.toFixed(2)}, elapsed: ${elapsedMs}ms`);
            }
            return {
                success: true,
                recoveryAttempts,
                finalDistanceToGoal: finalDistance,
                elapsedMs,
            };
        }

        if (result === 'error' && pathfindingError) {
            const err = pathfindingError as Error;
            if (isGoalChangedError(err)) {
                if (config.debug) {
                    console.log(`[Pathfinder] Goal changed, aborting`);
                }
                return {
                    success: false,
                    failureReason: 'goal_changed',
                    recoveryAttempts,
                    finalDistanceToGoal: finalDistance,
                    elapsedMs,
                };
            }

            // Check if unreachable
            if (err.message.includes('no path') ||
                err.message.includes('No path')) {
                if (config.debug) {
                    console.log(`[Pathfinder] No path found`);
                }
                return {
                    success: false,
                    failureReason: 'unreachable',
                    recoveryAttempts,
                    finalDistanceToGoal: finalDistance,
                    elapsedMs,
                };
            }
        }

        if (result === 'timeout') {
            if (config.debug) {
                console.log(`[Pathfinder] Timed out after ${elapsedMs}ms`);
            }
            return {
                success: false,
                failureReason: 'timeout',
                recoveryAttempts,
                finalDistanceToGoal: finalDistance,
                elapsedMs,
            };
        }

        // We're stuck - attempt recovery
        if (recoveryAttempts >= config.maxRecoveryAttempts) {
            if (config.debug) {
                console.log(`[Pathfinder] Stuck after ${recoveryAttempts} recovery attempts, giving up`);
            }
            return {
                success: false,
                failureReason: 'stuck',
                recoveryAttempts,
                finalDistanceToGoal: finalDistance,
                elapsedMs,
            };
        }

        // Try recovery action
        const action = RECOVERY_ACTIONS[recoveryActionIndex % RECOVERY_ACTIONS.length]!;
        if (config.debug) {
            console.log(`[Pathfinder] Stuck detected! Attempting recovery ${recoveryAttempts + 1}/${config.maxRecoveryAttempts}: ${action}`);
        }

        await attemptRecovery(bot, action, config.debug);
        recoveryAttempts++;
        recoveryActionIndex++;

        // Small delay before retrying pathfinding
        await sleep(200);
    }
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
export async function clearPath(bot: Bot): Promise<void> {
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
                console.log(`Failed to break block at ${blockPos}: ${err}`);
            }
        }
    }
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
    timeoutMs: number = 5000
): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Pathfinding attempt ${attempt + 1} of ${maxRetries + 1}`);
            await pathfinderGotoWithTimeout(bot, goal, timeoutMs);
            return true; // Success
        } catch (err) {
            console.log(`Pathfinding attempt ${attempt + 1} failed: ${err}`);

            // If this was a timeout, try to clear path before retrying
            if (isPathfinderTimeoutError(err) && attempt < maxRetries) {
                console.log('Pathfinding timed out, attempting to clear path...');
                await clearPath(bot);
                await sleep(1000); // Wait for dust to settle
            }

            // If we've reached max retries, give up
            if (attempt === maxRetries) {
                console.log('All pathfinding attempts failed');
                return false;
            }
        }
    }
    return false; // Should never reach here
}
