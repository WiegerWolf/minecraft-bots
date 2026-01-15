import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock } = goals;

export class DepositItems implements BehaviorNode {
    name = 'DepositItems';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.inventoryFull && bb.produceCount < 32) return 'failure';
        if (bb.nearbyChests.length === 0) return 'failure';

        const chest = bb.nearbyChests[0];
        if (!chest) return 'failure';

        console.log(`[BT] Depositing items at ${chest.position}`);
        bb.lastAction = 'deposit';

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(chest.position, bot.world));
            const container = await bot.openContainer(chest);

            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'poisonous_potato'];
            for (const item of bot.inventory.items()) {
                if (crops.includes(item.name)) {
                    await container.deposit(item.type, null, item.count);
                }
            }

            container.close();
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
