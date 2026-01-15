import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { sleep } from './utils';

const { GoalNear } = goals;

export class GatherWood implements BehaviorNode {
    name = 'GatherWood';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.hasHoe) return 'failure';
        if (bb.plankCount >= 4) return 'failure';
        if (bb.logCount > 0) return 'failure';

        const logNames = [
            'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
            'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'
        ];

        const logs = bot.findBlocks({
            matching: b => logNames.includes(b.name),
            maxDistance: 32,
            count: 1
        });

        if (logs.length === 0) return 'failure';

        const logPos = logs[0];
        if (!logPos) return 'failure';

        const logBlock = bot.blockAt(logPos);
        if (!logBlock) return 'failure';

        // Don't try to reach logs high up
        if (logBlock.position.y > bot.entity.position.y + 3) {
            return 'failure';
        }

        console.log(`[BT] Gathering wood at ${logBlock.position}`);
        bb.lastAction = 'gather_wood';

        try {
            await bot.pathfinder.goto(new GoalNear(logBlock.position.x, logBlock.position.y, logBlock.position.z, 2));
            await bot.dig(logBlock);
            await sleep(200);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
