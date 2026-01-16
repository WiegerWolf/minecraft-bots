import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../LumberjackBlackboard';

export type BehaviorStatus = 'success' | 'failure' | 'running';

export interface BehaviorNode {
    name: string;
    tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus>;
}
