import type { Bot } from 'mineflayer';

export interface Role {
    name: string;
    start(bot: Bot, options?: any): void;
    stop(bot: Bot): void;
    update(bot: Bot): Promise<void>;
}