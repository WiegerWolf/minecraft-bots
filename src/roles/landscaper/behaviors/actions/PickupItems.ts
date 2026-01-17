import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

// Cooldown for unreachable items
const UNREACHABLE_COOLDOWN = 5 * 60 * 1000;

/**
 * PickupItems - Collect dropped items (dirt, cobblestone, etc.)
 */
export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    private lastTargetId: number | null = null;
    private failedAttemptsAtTarget = 0;
    private readonly MAX_ATTEMPTS = 5;

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
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

        // If we've tried too many times, mark as unreachable
        if (this.failedAttemptsAtTarget >= this.MAX_ATTEMPTS) {
            console.log(`[Landscaper] Item ${drop.id} at ${drop.position.floored()} unreachable after ${this.MAX_ATTEMPTS} attempts`);
            bb.unreachableDrops.set(drop.id, now + UNREACHABLE_COOLDOWN);
            this.lastTargetId = null;
            this.failedAttemptsAtTarget = 0;
            return 'failure';
        }

        // If already very close, wait for auto-pickup
        if (dist < 1.5) {
            bb.lastAction = 'pickup_waiting';
            await new Promise(resolve => setTimeout(resolve, 300));

            const stillExists = Object.values(bot.entities).some(e => e.id === drop.id);
            if (!stillExists) {
                this.lastTargetId = null;
                this.failedAttemptsAtTarget = 0;
                return 'success';
            }

            return 'success';
        }

        // Move to pickup
        bb.lastAction = 'pickup_moving';
        console.log(`[Landscaper] Moving to pickup item at ${drop.position.floored()} (dist: ${dist.toFixed(1)})`);

        try {
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            return 'success';
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'unknown';
            if (!msg.includes('goal was changed') && !msg.includes('Path was stopped')) {
                console.log(`[Landscaper] Pickup path failed: ${msg}`);
            }
            return 'failure';
        }
    }
}
