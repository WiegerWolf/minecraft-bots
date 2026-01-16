import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from './types';

/**
 * Selector: Tries each child until one succeeds (OR logic)
 */
export class Selector implements BehaviorNode {
    name: string;

    constructor(name: string, private children: BehaviorNode[]) {
        this.name = name;
    }

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        for (const child of this.children) {
            const status = await child.tick(bot, bb);
            if (status !== 'failure') {
                return status;
            }
        }
        return 'failure';
    }
}

/**
 * Sequence: Runs all children in order, stops on first failure (AND logic)
 */
export class Sequence implements BehaviorNode {
    name: string;

    constructor(name: string, private children: BehaviorNode[]) {
        this.name = name;
    }

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        for (const child of this.children) {
            const status = await child.tick(bot, bb);
            if (status !== 'success') {
                return status;
            }
        }
        return 'success';
    }
}

/**
 * Condition: Instant boolean check against blackboard state
 */
export class Condition implements BehaviorNode {
    constructor(
        public name: string,
        private check: (bb: LumberjackBlackboard) => boolean
    ) {}

    async tick(_bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        return this.check(bb) ? 'success' : 'failure';
    }
}
