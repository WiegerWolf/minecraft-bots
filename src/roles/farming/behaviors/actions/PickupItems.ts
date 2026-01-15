import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { sleep } from './utils';

const { GoalNear } = goals;

export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.nearbyDrops.length === 0) return 'failure';
        if (bb.inventoryFull) return 'failure';

        const drop = bb.nearbyDrops[0];
        if (!drop) return 'failure';

        console.log(`[BT] Picking up item at ${drop.position.floored()}`);
        bb.lastAction = 'pickup';

        try {
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            await sleep(300);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
