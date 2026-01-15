import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class Explore implements BehaviorNode {
    name = 'Explore';
    private lastExploreTime = 0;

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Don't explore too frequently
        if (Date.now() - this.lastExploreTime < 5000) {
            return 'failure';
        }

        bb.consecutiveIdleTicks++;

        if (bb.consecutiveIdleTicks < 3) {
            return 'failure';
        }

        console.log(`[BT] Exploring for resources...`);
        bb.lastAction = 'explore';
        this.lastExploreTime = Date.now();

        // Pick a random direction
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 20;
        const target = bot.entity.position.offset(
            Math.cos(angle) * distance,
            0,
            Math.sin(angle) * distance
        );

        try {
            await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 3));
            bb.consecutiveIdleTicks = 0;
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
