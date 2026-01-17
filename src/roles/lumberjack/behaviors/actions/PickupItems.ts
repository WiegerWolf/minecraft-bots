import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

// Cooldown for unreachable items - long enough that they might despawn (5 minutes)
const UNREACHABLE_COOLDOWN = 5 * 60 * 1000;

/**
 * PickupItems - Collect dropped logs, saplings, and other items
 *
 * Handles unreachable items by tracking failed attempts in the blackboard
 * so that the goal's utility calculation reflects actual reachable drops.
 */
export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    // Track consecutive failures at current position (item might be in a hole)
    private lastTargetId: number | null = null;
    private failedAttemptsAtTarget = 0;
    private readonly MAX_ATTEMPTS = 5;

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
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

        const dist = bot.entity.position.distanceTo(drop.position);

        // Track attempts at this target
        if (this.lastTargetId === drop.id) {
            this.failedAttemptsAtTarget++;
        } else {
            this.lastTargetId = drop.id;
            this.failedAttemptsAtTarget = 0;
        }

        // If we've tried too many times, mark as unreachable in blackboard
        if (this.failedAttemptsAtTarget >= this.MAX_ATTEMPTS) {
            console.log(`[Lumberjack] Item ${drop.id} at ${drop.position.floored()} unreachable after ${this.MAX_ATTEMPTS} attempts`);
            // Mark in blackboard so it affects nearbyDrops count and goal utility
            bb.unreachableDrops.set(drop.id, now + UNREACHABLE_COOLDOWN);
            this.lastTargetId = null;
            this.failedAttemptsAtTarget = 0;
            return 'failure';
        }

        // If already very close, just wait briefly for auto-pickup
        if (dist < 1.5) {
            bb.lastAction = 'pickup_waiting';
            await new Promise(resolve => setTimeout(resolve, 300));

            // Check if item still exists (was it picked up?)
            const stillExists = Object.values(bot.entities).some(e => e.id === drop.id);
            if (!stillExists) {
                // Success! Item was picked up
                this.lastTargetId = null;
                this.failedAttemptsAtTarget = 0;
                return 'success';
            }

            // Item still there - will increment failedAttemptsAtTarget next tick
            return 'success'; // Return success to keep the goal active
        }

        // Move to pickup
        bb.lastAction = 'pickup_moving';
        console.log(`[Lumberjack] Moving to pickup item at ${drop.position.floored()} (dist: ${dist.toFixed(1)})`);

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1),
                { timeoutMs: 15000 }
            );

            if (!result.success) {
                console.log(`[Lumberjack] Pickup path failed: ${result.failureReason}`);
                return 'failure';
            }
            return 'success';
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'unknown';
            // Don't log common pathfinding interruptions
            if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                console.log(`[Lumberjack] Pickup path error: ${msg}`);
            }
            // Pathfinding failed counts as an attempt
            return 'failure';
        }
    }
}
