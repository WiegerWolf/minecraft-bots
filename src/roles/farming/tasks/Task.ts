import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';

export interface WorkProposal {
    priority: number;      // Higher numbers = more urgent (1-10: Low, 10-50: Normal, 100+: Critical)
    description: string;   // For logging
    target?: any;          // The block/entity to interact with (used for movement)
    range?: number;        // How close we need to be (default 3.5)
    task: Task;            // Reference back to the task instance
}

export interface Task {
    name: string;
    findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null>;
    perform(bot: Bot, role: FarmingRole, target?: any): Promise<void>;
}