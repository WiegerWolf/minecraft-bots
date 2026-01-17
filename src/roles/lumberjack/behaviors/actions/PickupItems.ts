import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

/**
 * PickupItems - Collect dropped logs, saplings, and other items
 *
 * Handles unreachable items by tracking failed attempts and skipping them.
 */
export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    // Track items we've failed to pick up (by entity id -> expiry time)
    private unreachableItems = new Map<number, number>();
    private readonly UNREACHABLE_COOLDOWN = 15000; // 15 seconds

    // Track consecutive failures at current position (item might be in a hole)
    private lastTargetId: number | null = null;
    private failedAttemptsAtTarget = 0;
    private readonly MAX_ATTEMPTS = 5;

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        if (bb.nearbyDrops.length === 0) {
            return 'failure';
        }
        if (bb.inventoryFull) {
            return 'failure';
        }

        // Clean up expired unreachable entries
        const now = Date.now();
        for (const [id, expiry] of this.unreachableItems) {
            if (now >= expiry) {
                this.unreachableItems.delete(id);
            }
        }

        // Filter out unreachable items
        const reachableDrops = bb.nearbyDrops.filter(d => !this.unreachableItems.has(d.id));

        if (reachableDrops.length === 0) {
            // All items unreachable - clear the oldest half and try again next tick
            if (this.unreachableItems.size > 0) {
                const entries = [...this.unreachableItems.entries()].sort((a, b) => a[1] - b[1]);
                const toRemove = Math.ceil(entries.length / 2);
                for (let i = 0; i < toRemove; i++) {
                    const entry = entries[i];
                    if (entry) this.unreachableItems.delete(entry[0]);
                }
            }
            return 'failure';
        }

        // Find closest reachable drop
        const sorted = [...reachableDrops].sort((a, b) =>
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

        // If we've tried too many times, mark as unreachable
        if (this.failedAttemptsAtTarget >= this.MAX_ATTEMPTS) {
            console.log(`[Lumberjack] Item ${drop.id} at ${drop.position.floored()} unreachable after ${this.MAX_ATTEMPTS} attempts`);
            this.unreachableItems.set(drop.id, now + this.UNREACHABLE_COOLDOWN);
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
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            return 'success';
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'unknown';
            // Don't log common pathfinding interruptions
            if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                console.log(`[Lumberjack] Pickup path failed: ${msg}`);
            }
            // Pathfinding failed counts as an attempt
            return 'failure';
        }
    }
}
