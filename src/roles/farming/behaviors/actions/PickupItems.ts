import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { sleep } from './utils';

const { GoalNear } = goals;

// Track items we've failed to pick up to avoid infinite loops
const failedPickups = new Set<number>();

export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.nearbyDrops.length === 0) return 'failure';
        if (bb.inventoryFull) return 'failure';

        // Find first drop we haven't failed on
        const drop = bb.nearbyDrops.find(d => !failedPickups.has(d.id));
        if (!drop) {
            // Clear failed pickups periodically to retry
            if (failedPickups.size > 0) {
                failedPickups.clear();
            }
            return 'failure';
        }

        const dropId = drop.id;
        console.log(`[BT] Picking up item at ${drop.position.floored()}`);
        bb.lastAction = 'pickup';

        try {
            // Walk directly to the item (radius 0)
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 0));
            await sleep(500);

            // Check if item still exists (if it does, we failed to pick it up)
            const stillExists = Object.values(bot.entities).some(e => e.id === dropId);
            if (stillExists) {
                console.log(`[BT] Failed to pick up item, marking as unreachable`);
                failedPickups.add(dropId);
                return 'failure';
            }

            return 'success';
        } catch {
            failedPickups.add(dropId);
            return 'failure';
        }
    }
}
