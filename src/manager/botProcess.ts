import { spawn, type Subprocess } from 'bun';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { faker } from '@faker-js/faker';
import type { BotConfig, LogEntry } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const BOT_PATH = resolve(__dirname, '../bot.ts');

/**
 * Generate a bot name using faker with the role label.
 * Format: FirstName_RoleLabel (e.g., "Emma_Farmer", "Oscar_Lmbr")
 * Must fit within Minecraft's 16 character username limit.
 */
export function generateBotName(roleLabel: string): string {
  const maxFirstNameLen = 16 - roleLabel.length - 1;
  let firstName = faker.person.firstName();
  firstName = firstName.substring(0, maxFirstNameLen).replace(/[^a-zA-Z0-9]/g, '');
  return `${firstName}_${roleLabel}`;
}

/**
 * Parse a JSON log line from a bot subprocess.
 */
export function parseLogLine(line: string, fallbackBotName: string, nextId: () => number): LogEntry | null {
  if (!line.trim()) return null;

  try {
    const log = JSON.parse(line);
    if (typeof log.level !== 'number' || !log.time) {
      return {
        id: nextId(),
        timestamp: new Date(),
        botName: fallbackBotName,
        level: 30,
        message: line,
        extras: {},
        raw: line,
      };
    }

    const {
      level,
      time,
      msg,
      component,
      role: _role,
      pid: _pid,
      hostname: _hostname,
      botName,
      ...extras
    } = log;

    return {
      id: nextId(),
      timestamp: new Date(time),
      botName: botName || fallbackBotName,
      level,
      message: msg || '',
      component,
      extras,
      raw: line,
    };
  } catch {
    return {
      id: nextId(),
      timestamp: new Date(),
      botName: fallbackBotName,
      level: 30,
      message: line,
      extras: {},
      raw: line,
    };
  }
}

export interface SpawnBotOptions {
  config: BotConfig;
  sessionId: string;
  botName: string;
  onLog: (entry: LogEntry) => void;
  onExit: (exitCode: number) => void;
  onSpawnSuccess: () => void;
  getNextLogId: () => number;
}

/**
 * Spawn a bot process and set up log streaming.
 */
export function spawnBot(options: SpawnBotOptions): Subprocess {
  const { config, sessionId, botName, onLog, onExit, onSpawnSuccess, getNextLogId } = options;

  const botProcess = spawn(['bun', 'run', BOT_PATH], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      BOT_ROLE: config.role,
      BOT_NAME: botName,
      ROLE_LABEL: config.roleLabel,
      SESSION_ID: sessionId,
    },
  });

  // Handle stdout
  const handleOutput = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) continue;

        // Check for spawn marker
        if (line.includes('✅ Bot has spawned!')) {
          onSpawnSuccess();
        }

        const entry = parseLogLine(line, botName, getNextLogId);
        if (entry) {
          onLog(entry);
        }
      }
    }

    if (buffer) {
      const entry = parseLogLine(buffer, botName, getNextLogId);
      if (entry) {
        onLog(entry);
      }
    }
  };

  handleOutput(botProcess.stdout as ReadableStream<Uint8Array> | null);
  handleOutput(botProcess.stderr as ReadableStream<Uint8Array> | null);

  botProcess.exited.then(onExit);

  return botProcess;
}
