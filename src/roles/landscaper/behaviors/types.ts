import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../LandscaperBlackboard';

export type BehaviorStatus = 'success' | 'failure' | 'running';

export interface BehaviorNode {
    name: string;
    tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus>;
}
