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
  state: BotState | null;
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

// Bot name colors - shared between sidebar and logs
export const BOT_COLORS = ['blue', 'magenta', 'cyan', 'green', 'yellow'] as const;
export type BotColor = typeof BOT_COLORS[number];

const MAX_BOT_COLOR_ENTRIES = 50;
const botColorMap = new Map<string, BotColor>();
let colorIndex = 0;

export function getBotColor(botName: string): BotColor {
  if (!botName) return BOT_COLORS[0]!;
  if (!botColorMap.has(botName)) {
    // Prevent unbounded growth - clear oldest entries if at limit
    if (botColorMap.size >= MAX_BOT_COLOR_ENTRIES) {
      const firstKey = botColorMap.keys().next().value;
      if (firstKey) botColorMap.delete(firstKey);
    }
    botColorMap.set(botName, BOT_COLORS[colorIndex % BOT_COLORS.length]!);
    colorIndex++;
  }
  return botColorMap.get(botName)!;
}

// Bot state message protocol
export interface GoalUtility {
  name: string;
  utility: number;
  isCurrent: boolean;
  isInvalid?: boolean;
  isZero?: boolean;
}

export interface ActionHistoryEntry {
  action: string;
  timestamp: number;
  success: boolean;
  failureCount?: number;
}

export interface BotStateMessage {
  type: 'bot_state';
  botName: string;
  timestamp: number;
  currentGoal: string | null;
  currentGoalUtility: number;
  currentAction: string | null;
  actionProgress: { current: number; total: number } | null;
  planProgress: number; // 0-100
  goalUtilities: GoalUtility[];
  actionHistory: ActionHistoryEntry[];
  stats: {
    actionsExecuted: number;
    actionsSucceeded: number;
    actionsFailed: number;
    replansRequested: number;
  };
  goalsOnCooldown: string[];
}

export interface BotState {
  lastUpdate: number;
  currentGoal: string | null;
  currentGoalUtility: number;
  currentAction: string | null;
  actionProgress: { current: number; total: number } | null;
  planProgress: number;
  goalUtilities: GoalUtility[];
  actionHistory: ActionHistoryEntry[];
  stats: {
    actionsExecuted: number;
    actionsSucceeded: number;
    actionsFailed: number;
    replansRequested: number;
  };
  goalsOnCooldown: string[];
}
