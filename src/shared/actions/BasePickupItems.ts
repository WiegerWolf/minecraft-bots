import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../PathfindingUtils';
import type { Logger } from '../logger';

const { GoalNear } = goals;

// Cooldown for unreachable items - long enough that they might despawn (5 minutes)
const UNREACHABLE_COOLDOWN = 5 * 60 * 1000;

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

        // Find closest drop
        const sorted = [...bb.nearbyDrops].sort((a, b) =>
            bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
        );

        const drop = sorted[0];
        if (!drop) return 'failure';

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
            return 'failure';
        }

        // If very close, walk directly into the item to trigger pickup
        if (dist < 1.0) {
            bb.lastAction = this.config.lastActionWaiting;
            // Walk directly toward the item
            const direction = drop.position.minus(bot.entity.position);
            const yaw = Math.atan2(-direction.x, -direction.z);
            await bot.look(yaw, 0);
            bot.setControlState('forward', true);
            await sleep(300);
            bot.clearControlStates();
            await sleep(100);

            // Check if item was picked up
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            if (!stillExists) {
                // Success! Item was picked up
                this.lastTargetId = null;
                this.failedAttemptsAtTarget = 0;
                this.lastDistanceToTarget = Infinity;
                return 'success';
            }

            // Still there, will retry next tick
            return 'success';
        }

        // If close but not very close, wait for auto-pickup briefly
        if (this.config.closeDistanceThreshold > 0 && dist < this.config.closeDistanceThreshold) {
            bb.lastAction = this.config.lastActionWaiting;
            await sleep(this.config.closeDistanceWaitMs);

            // Check if item still exists (was it picked up?)
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            if (!stillExists) {
                // Success! Item was picked up
                this.lastTargetId = null;
                this.failedAttemptsAtTarget = 0;
                this.lastDistanceToTarget = Infinity;
                return 'success';
            }

            // Item still there but we're close - continue to pathfind closer
        }

        // Move to pickup
        bb.lastAction = this.config.lastActionMoving;
        bb.log?.debug(
            `[${this.config.roleLabel}] Moving to pickup item at ${drop.position.floored()} (dist: ${dist.toFixed(1)})`
        );

        try {
            // Use a smaller goal radius to get closer to the item
            const goalRadius = Math.max(0.5, this.config.goalRadius);
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(drop.position.x, drop.position.y, drop.position.z, goalRadius),
                {
                    timeoutMs: this.config.pathfindingTimeoutMs,
                    // Enable knight's move recovery for any significant distance
                    knightMoveRecovery: dist > 2,
                }
            );

            if (!result.success) {
                bb.log?.debug(`[${this.config.roleLabel}] Pickup path failed: ${result.failureReason}`);
                return 'failure';
            }

            // After pathfinding, walk directly into the item
            const newDist = bot.entity.position.distanceTo(drop.position);
            if (newDist < goalRadius + 1) {
                const direction = drop.position.minus(bot.entity.position);
                const yaw = Math.atan2(-direction.x, -direction.z);
                await bot.look(yaw, 0);

                // Walk toward item, stopping when close enough or item picked up
                bot.setControlState('forward', true);
                const startTime = Date.now();
                const maxWalkTime = 800;

                while (Date.now() - startTime < maxWalkTime) {
                    const currentDist = bot.entity.position.distanceTo(drop.position);
                    if (currentDist < 0.5) break; // Close enough for pickup
                    // Check if item was already picked up
                    const exists = Object.values(bot.entities).some(e => e.id === dropId);
                    if (!exists) break;
                    await sleep(50);
                }

                bot.clearControlStates();
            }

            await sleep(this.config.closeDistanceWaitMs);

            // Check if item was picked up
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            if (!stillExists) {
                // Success! Reset tracking
                this.lastTargetId = null;
                this.failedAttemptsAtTarget = 0;
                this.lastDistanceToTarget = Infinity;
            }

            return 'success';
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'unknown';
            // Don't log common pathfinding interruptions
            if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                bb.log?.debug(`[${this.config.roleLabel}] Pickup path error: ${msg}`);
            }
            return 'failure';
        }
    }
}
