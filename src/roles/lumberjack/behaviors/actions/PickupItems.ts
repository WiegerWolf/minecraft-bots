import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

/**
 * PickupItems - Collect dropped logs, saplings, and other items
 */
export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        if (bb.nearbyDrops.length === 0) return 'failure';
        if (bb.inventoryFull) return 'failure';

        // Find closest drop
        const sorted = [...bb.nearbyDrops].sort((a, b) =>
            bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
        );

        const drop = sorted[0];
        if (!drop) return 'failure';

        const dist = bot.entity.position.distanceTo(drop.position);

        // If already close, wait for pickup
        if (dist < 2) {
            bb.lastAction = 'pickup_waiting';
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'success';
        }

        // Move to pickup
        bb.lastAction = 'pickup_moving';
        console.log(`[Lumberjack] Moving to pickup item at ${drop.position.floored()}`);

        try {
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
