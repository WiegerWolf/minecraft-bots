import type { Bot } from 'mineflayer';
import type { Logger } from '../shared/logger';

/**
 * Options passed to a role when starting.
 */
export interface RoleStartOptions {
    /** Optional logger instance for structured logging */
    logger?: Logger;
    /** Additional role-specific options */
    [key: string]: any;
}

export interface Role {
    name: string;
    start(bot: Bot, options?: RoleStartOptions): void;
    stop(bot: Bot): void;
}