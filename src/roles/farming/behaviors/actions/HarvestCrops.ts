import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { sleep } from './utils';

const { GoalLookAtBlock } = goals;

export class HarvestCrops implements BehaviorNode {
    name = 'HarvestCrops';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canHarvest) return 'failure';

        const crop = bb.nearbyMatureCrops[0];
        if (!crop) return 'failure';

        console.log(`[BT] Harvesting ${crop.name} at ${crop.position}`);
        bb.lastAction = 'harvest';

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(crop.position, bot.world));
            await bot.dig(crop);
            await sleep(200);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
