import type { Bot } from 'mineflayer';

export interface Role {
    name: string;
    start(bot: Bot): void;
    stop(bot: Bot): void;
    update(bot: Bot): void;
}
