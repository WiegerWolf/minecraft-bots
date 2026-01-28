import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { GoalNear } from 'baritone-ts';
import { smartPathfinderGoto } from '../PathfindingUtils';
import type { Logger } from '../logger';

// Cooldown for unreachable items - long enough that they might despawn (5 minutes)
const UNREACHABLE_COOLDOWN = 5 * 60 * 1000;

/**
 * Walk toward an item and wait for pickup using event-driven approach.
 * Resolves immediately when item is collected, or after timeout.
 */
function walkTowardAndCollect(
    bot: Bot,
    drop: Entity,
    maxWalkTimeMs: number
): Promise<boolean> {
    return new Promise(resolve => {
        const dropId = drop.id;
        let resolved = false;
        let timeoutHandle: ReturnType<typeof setTimeout>;

        const cleanup = () => {
            if (resolved) return;
            resolved = true;
            bot.clearControlStates();
            bot.removeListener('playerCollect', onCollect);
            clearTimeout(timeoutHandle);
        };

        const onCollect = (collector: Entity, collected: Entity) => {
            if (collected.id === dropId) {
                cleanup();
                resolve(true);
            }
        };

        bot.on('playerCollect', onCollect);

        // Look at item and walk forward
        const direction = drop.position.minus(bot.entity.position);
        const yaw = Math.atan2(-direction.x, -direction.z);
        bot.look(yaw, 0).then(() => {
            if (!resolved) {
                bot.setControlState('forward', true);
            }
        });

        // Timeout fallback
        timeoutHandle = setTimeout(() => {
            cleanup();
            // Check if item still exists
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            resolve(!stillExists);
        }, maxWalkTimeMs);
    });
}

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * Minimal blackboard interface required by BasePickupItems.
 * Role-specific blackboards should extend this.
 */
export interface PickupItemsBlackboard {
    nearbyDrops: Entity[];
    inventoryFull: boolean;
    unreachableDrops: Map<number, number>;
    lastAction: string;
    log?: Logger | null;
}

/**
 * Configuration options for pickup behavior.
 */
export interface PickupItemsConfig {
    /** Maximum attempts before marking item as unreachable (default: 5) */
    maxAttempts?: number;
    /** Distance threshold for "close enough" auto-pickup wait (default: 1.5, set to 0 to disable) */
    closeDistanceThreshold?: number;
    /** Time to wait when close for auto-pickup in ms (default: 300) */
    closeDistanceWaitMs?: number;
    /** Pathfinding goal radius (default: 1) */
    goalRadius?: number;
    /** Pathfinding timeout in ms (default: 15000) */
    pathfindingTimeoutMs?: number;
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** lastAction value when moving (default: 'pickup_moving') */
    lastActionMoving?: string;
    /** lastAction value when waiting close (default: 'pickup_waiting') */
    lastActionWaiting?: string;
}

const DEFAULT_CONFIG: Required<PickupItemsConfig> = {
    maxAttempts: 5,
    closeDistanceThreshold: 1.5,
    closeDistanceWaitMs: 300,
    goalRadius: 1,
    pathfindingTimeoutMs: 15000,
    roleLabel: 'Bot',
    lastActionMoving: 'pickup_moving',
    lastActionWaiting: 'pickup_waiting',
};

/**
 * Base class for picking up dropped items.
 *
 * Handles:
 * - Finding closest reachable drop
 * - Tracking failed attempts per item
 * - Marking items as unreachable after max attempts
 * - Auto-pickup wait when close
 * - Pathfinding with timeout
 *
 * Usage:
 * ```typescript
 * export class PickupItems extends BasePickupItems<MyBlackboard> {
 *     constructor() {
 *         super({ maxAttempts: 3, roleLabel: 'Farmer' });
 *     }
 * }
 * ```
 */
export abstract class BasePickupItems<TBlackboard extends PickupItemsBlackboard> {
    readonly name = 'PickupItems';
    protected config: Required<PickupItemsConfig>;

    // Track consecutive failures at current target
    private lastTargetId: number | null = null;
    private failedAttemptsAtTarget = 0;
    private lastDistanceToTarget: number = Infinity;

    constructor(config?: PickupItemsConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        // nearbyDrops is already filtered by the blackboard to exclude unreachable items
        if (bb.nearbyDrops.length === 0) {
            return 'failure';
        }
        if (bb.inventoryFull) {
            return 'failure';
        }

        const now = Date.now();
        let collectedAny = false;
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 3;

        // Batch collect all visible drops in one sweep
        while (true) {
            // Re-fetch and sort drops each iteration (our position changed, some may be collected)
            const currentDrops = bb.nearbyDrops.filter(e =>
                e.position && Object.values(bot.entities).some(entity => entity.id === e.id)
            );

            if (currentDrops.length === 0) break;
            if (bb.inventoryFull) break;
            if (consecutiveFailures >= maxConsecutiveFailures) break;

            // Sort by distance from current position
            const sorted = currentDrops.sort((a, b) =>
                bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
            );

            const drop = sorted[0];
            if (!drop) break;

            const dropId = drop.id;
            const dist = bot.entity.position.distanceTo(drop.position);

            // Track attempts at this target - only increment if we didn't make progress
            if (this.lastTargetId === dropId) {
                // Only count as failed attempt if we didn't get significantly closer
                const madeProgress = dist < this.lastDistanceToTarget - 0.5;
                if (!madeProgress) {
                    this.failedAttemptsAtTarget++;
                }
            } else {
                this.lastTargetId = dropId;
                this.failedAttemptsAtTarget = 0;
            }
            this.lastDistanceToTarget = dist;

            // If we've tried too many times without progress, mark as unreachable
            if (this.failedAttemptsAtTarget >= this.config.maxAttempts) {
                bb.log?.debug(
                    `[${this.config.roleLabel}] Item ${dropId} at ${drop.position.floored()} unreachable after ${this.config.maxAttempts} attempts without progress`
                );
                bb.unreachableDrops.set(dropId, now + UNREACHABLE_COOLDOWN);
                this.lastTargetId = null;
                this.failedAttemptsAtTarget = 0;
                this.lastDistanceToTarget = Infinity;
                consecutiveFailures++;
                continue; // Try next drop
            }

            // If close enough, walk directly into the item
            if (dist < this.config.closeDistanceThreshold) {
                bb.lastAction = this.config.lastActionWaiting;

                // Event-driven: walk toward item, resolve on playerCollect
                const walkTime = Math.min(600, Math.max(200, dist * 150));
                const pickedUp = await walkTowardAndCollect(bot, drop, walkTime);

                if (pickedUp) {
                    this.lastTargetId = null;
                    this.failedAttemptsAtTarget = 0;
                    this.lastDistanceToTarget = Infinity;
                    collectedAny = true;
                    consecutiveFailures = 0;
                } else {
                    consecutiveFailures++;
                }
                continue; // Move to next drop
            }

            // Move to pickup (farther item)
            bb.lastAction = this.config.lastActionMoving;
            bb.log?.debug(
                `[${this.config.roleLabel}] Moving to pickup item at ${drop.position.floored()} (dist: ${dist.toFixed(1)}, remaining: ${currentDrops.length})`
            );

            try {
                // Use a smaller goal radius to get closer to the item
                const goalRadius = Math.max(0.5, this.config.goalRadius);
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(drop.position.x, drop.position.y, drop.position.z, goalRadius),
                    {
                        timeoutMs: this.config.pathfindingTimeoutMs,
                        // Disable knight's move recovery for item pickup - drops are usually nearby
                        // and pathfinding failures are transient. The L-shaped escape is too disruptive.
                        knightMoveRecovery: false,
                    }
                );

                if (!result.success) {
                    bb.log?.debug(`[${this.config.roleLabel}] Pickup path failed: ${result.failureReason}`);
                    consecutiveFailures++;
                    continue; // Try next drop
                }

                // After pathfinding, walk directly into the item
                const newDist = bot.entity.position.distanceTo(drop.position);
                if (newDist < goalRadius + 1) {
                    // Event-driven: walk toward item, resolve on playerCollect
                    const walkTime = Math.min(800, Math.max(200, newDist * 200));
                    const pickedUp = await walkTowardAndCollect(bot, drop, walkTime);

                    if (pickedUp) {
                        this.lastTargetId = null;
                        this.failedAttemptsAtTarget = 0;
                        this.lastDistanceToTarget = Infinity;
                        collectedAny = true;
                        consecutiveFailures = 0;
                    } else {
                        consecutiveFailures++;
                    }
                }
                // Continue to next drop regardless
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'unknown';
                // Don't log common pathfinding interruptions
                if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                    bb.log?.debug(`[${this.config.roleLabel}] Pickup path error: ${msg}`);
                }
                consecutiveFailures++;
                // Continue to try next drop
            }
        }

        return collectedAny ? 'success' : 'failure';
    }
}
