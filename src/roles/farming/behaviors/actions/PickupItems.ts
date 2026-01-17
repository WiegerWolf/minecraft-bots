import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { sleep } from './utils';

const { GoalNear } = goals;

// Cooldown for unreachable items - long enough that they might despawn (5 minutes)
const UNREACHABLE_COOLDOWN = 5 * 60 * 1000;

export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    // Track consecutive failures at current target
    private lastTargetId: number | null = null;
    private failedAttemptsAtTarget = 0;
    private readonly MAX_ATTEMPTS = 3;

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // nearbyDrops is already filtered by the blackboard to exclude unreachable items
        if (bb.nearbyDrops.length === 0) return 'failure';
        if (bb.inventoryFull) return 'failure';

        const now = Date.now();

        // Find closest drop
        const sorted = [...bb.nearbyDrops].sort((a, b) =>
            bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
        );

        const drop = sorted[0];
        if (!drop) return 'failure';

        const dropId = drop.id;

        // Track attempts at this target
        if (this.lastTargetId === dropId) {
            this.failedAttemptsAtTarget++;
        } else {
            this.lastTargetId = dropId;
            this.failedAttemptsAtTarget = 0;
        }

        // If we've tried too many times, mark as unreachable in blackboard
        if (this.failedAttemptsAtTarget >= this.MAX_ATTEMPTS) {
            console.log(`[BT] Item ${dropId} at ${drop.position.floored()} unreachable after ${this.MAX_ATTEMPTS} attempts`);
            bb.unreachableDrops.set(dropId, now + UNREACHABLE_COOLDOWN);
            this.lastTargetId = null;
            this.failedAttemptsAtTarget = 0;
            return 'failure';
        }

        console.log(`[BT] Picking up item at ${drop.position.floored()}`);
        bb.lastAction = 'pickup';

        try {
            // Walk directly to the item (radius 0)
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 0));
            await sleep(500);

            // Check if item still exists (if it does, we failed to pick it up)
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            if (stillExists) {
                // Will increment failedAttemptsAtTarget next tick
                return 'failure';
            }

            // Success! Reset tracking
            this.lastTargetId = null;
            this.failedAttemptsAtTarget = 0;
            return 'success';
        } catch {
            // Pathfinding failed counts as an attempt
            return 'failure';
        }
    }
}
