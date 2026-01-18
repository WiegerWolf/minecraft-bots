import type { Subprocess } from 'bun';

export type BotStatus = 'stopped' | 'starting' | 'running' | 'crashed' | 'restarting';

export interface BotConfig {
  role: string;
  roleLabel: string;
  aliases: string[];
}

export interface ManagedBot {
  id: string;
  config: BotConfig;
  status: BotStatus;
  process: Subprocess | null;
  name: string;
  reconnectAttempts: number;
}

export interface LogEntry {
  id: number;
  timestamp: Date;
  botName: string;  // Full bot name like "Emma_Farmer"
  level: number;
  message: string;
  component?: string;
  extras: Record<string, unknown>;
  raw: string;
}

// Log levels for filtering
export const LOG_LEVELS = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;

export const DEFAULT_BOT_CONFIGS: BotConfig[] = [
  { role: 'goap-farming', roleLabel: 'Farmer', aliases: ['farmer', 'farm'] },
  { role: 'goap-lumberjack', roleLabel: 'Lmbr', aliases: ['lumberjack', 'lumber', 'lmbr'] },
  { role: 'landscaper', roleLabel: 'Land', aliases: ['landscaper', 'land'] },
];

export const MAX_BACKOFF = 30000;
export const INITIAL_BACKOFF = 1000;
export const BOT_SPAWN_DELAY = 2000;
