import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../Blackboard';

export type BehaviorStatus = 'success' | 'failure' | 'running';

export interface BehaviorNode {
    name: string;
    tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus>;
}
