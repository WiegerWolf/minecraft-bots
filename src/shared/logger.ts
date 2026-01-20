import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  botName: string;
  role: string;
  roleLabel: string;
  sessionId: string;
}

/**
 * Type alias for the logger instance.
 */
export type Logger = pino.Logger;

// ANSI color codes for beautiful output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Bot color assignments (cycle through for multiple bots)
const botColors = [
  { bg: colors.bgBlue, fg: colors.white },
  { bg: colors.bgMagenta, fg: colors.white },
  { bg: colors.bgCyan, fg: colors.black },
  { bg: colors.bgGreen, fg: colors.black },
  { bg: colors.bgYellow, fg: colors.black },
];

// Track bot color assignments
const botColorMap = new Map<string, (typeof botColors)[0]>();
let colorIndex = 0;

function getBotColor(botName: string) {
  if (!botColorMap.has(botName)) {
    botColorMap.set(botName, botColors[colorIndex % botColors.length]!);
    colorIndex++;
  }
  return botColorMap.get(botName)!;
}

// Log level styling
const levelConfig: Record<
  number,
  { icon: string; label: string; color: string }
> = {
  10: { icon: '🔍', label: 'TRACE', color: colors.gray },
  20: { icon: '🐛', label: 'DEBUG', color: colors.cyan },
  30: { icon: '●', label: 'INFO', color: colors.green },
  40: { icon: '⚠', label: 'WARN', color: colors.yellow },
  50: { icon: '✖', label: 'ERROR', color: colors.red },
  60: { icon: '💀', label: 'FATAL', color: colors.brightRed },
};

/**
 * Format a timestamp to HH:MM:SS
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toTimeString().slice(0, 8);
}

/**
 * Format extra properties nicely
 */
function formatExtras(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '';

  const formatted = entries
    .map(([key, value]) => {
      const valueStr =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${colors.dim}${key}${colors.reset}${colors.gray}=${colors.reset}${colors.brightCyan}${valueStr}${colors.reset}`;
    })
    .join(' ');

  return ` ${formatted}`;
}

/**
 * Create a pretty console stream
 */
function createPrettyStream(): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const log = JSON.parse(chunk.toString());

        // Extract known fields
        const {
          level,
          time,
          msg,
          botName,
          component,
          // Ignored fields
          role: _role,
          pid: _pid,
          hostname: _hostname,
          ...extras
        } = log;

        // Get level styling
        const levelStyle = levelConfig[level] || {
          icon: '?',
          label: 'UNKNOWN',
          color: colors.white,
        };

        // Format timestamp
        const timestamp = `${colors.dim}${formatTime(time)}${colors.reset}`;

        // Format level
        const levelStr = `${levelStyle.color}${levelStyle.icon}${colors.reset}`;

        // Format bot name badge
        let botBadge = '';
        if (botName) {
          const botColor = getBotColor(botName);
          botBadge = `${botColor.bg}${botColor.fg}${colors.bold} ${botName} ${colors.reset} `;
        }

        // Format component
        const componentStr = component
          ? `${colors.dim}[${component}]${colors.reset} `
          : '';

        // Format message
        const message = `${msg || ''}`;

        // Format extras (remaining properties)
        const extrasStr = formatExtras(extras);

        // Compose final output
        const output = `${timestamp} ${levelStr} ${botBadge}${componentStr}${message}${extrasStr}\n`;

        process.stdout.write(output);
        callback();
      } catch {
        // If parsing fails, just write the raw chunk
        process.stdout.write(chunk);
        callback();
      }
    },
  });
}

/**
 * Create a pretty console stream for the manager (no bot name)
 */
function createManagerPrettyStream(): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const log = JSON.parse(chunk.toString());

        const {
          level,
          time,
          msg,
          pid: _pid,
          hostname: _hostname,
          ...extras
        } = log;

        const levelStyle = levelConfig[level] || {
          icon: '?',
          label: 'UNKNOWN',
          color: colors.white,
        };

        const timestamp = `${colors.dim}${formatTime(time)}${colors.reset}`;
        const levelStr = `${levelStyle.color}${levelStyle.icon}${colors.reset}`;

        // Manager badge
        const managerBadge = `${colors.bgWhite}${colors.black}${colors.bold} MANAGER ${colors.reset} `;

        const message = `${msg || ''}`;
        const extrasStr = formatExtras(extras);

        const output = `${timestamp} ${levelStr} ${managerBadge}${message}${extrasStr}\n`;

        process.stdout.write(output);
        callback();
      } catch {
        process.stdout.write(chunk);
        callback();
      }
    },
  });
}

/**
 * Generate a session ID for the current run.
 * Format: YYYY-MM-DD_HH-MM-SS (sortable, filesystem-safe)
 */
export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // HH-MM-SS
  return `${date}_${time}`;
}

/**
 * Get the log directory for a session.
 * Creates the directory if it doesn't exist.
 * Updates the 'latest' symlink to point to this session.
 */
function getLogDir(sessionId: string): string {
  const logsBase = path.join(process.cwd(), 'logs');
  const logDir = path.join(logsBase, sessionId);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Update 'latest' symlink
  const latestLink = path.join(logsBase, 'latest');
  try {
    // Remove existing symlink if present
    if (fs.existsSync(latestLink) || fs.lstatSync(latestLink).isSymbolicLink()) {
      fs.unlinkSync(latestLink);
    }
  } catch {
    // Symlink doesn't exist, that's fine
  }
  try {
    fs.symlinkSync(sessionId, latestLink);
  } catch {
    // Symlink creation may fail on some systems, not critical
  }

  return logDir;
}

/**
 * Create a logger instance for a bot.
 *
 * Outputs to both:
 * - stdout (with beautiful formatting for readable console output)
 * - log file in logs/SESSION_ID/RoleLabel.log (JSON format for grep/analysis)
 */
export function createBotLogger(options: LoggerOptions): Logger {
  const { botName, role, roleLabel, sessionId } = options;
  const logLevel = process.env.LOG_LEVEL || 'debug';

  const logDir = getLogDir(sessionId);
  const logFile = path.join(logDir, `${roleLabel}.log`);

  // Create file stream for JSON logs
  const fileStream = fs.createWriteStream(logFile, { flags: 'a' });

  // Determine if we should use pretty printing (development)
  const isPretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;

  // Create multi-destination transport
  const streams: pino.StreamEntry[] = [];

  if (isPretty) {
    // Beautiful console output
    streams.push({
      level: logLevel as pino.Level,
      stream: createPrettyStream(),
    });
  } else {
    // Plain JSON to stdout in production/non-TTY
    streams.push({
      level: logLevel as pino.Level,
      stream: process.stdout,
    });
  }

  // Always write JSON to file
  streams.push({
    level: logLevel as pino.Level,
    stream: fileStream,
  });

  const logger = pino(
    {
      level: logLevel,
      base: {
        botName,
        role,
      },
      // Custom timestamp format
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams)
  );

  return logger;
}

/**
 * Create a child logger for a specific component.
 */
export function createChildLogger(parent: Logger, component: string): Logger {
  return parent.child({ component });
}

/**
 * Options for creating a test logger.
 */
export interface TestLoggerOptions {
  /** Bot/test name for identification */
  botName: string;
  /** Role name (e.g., 'farmer', 'lumberjack') */
  role: string;
  /** Label for log file (defaults to role) */
  roleLabel?: string;
  /** Test session ID (auto-generated if not provided) */
  sessionId?: string;
  /** Log level (defaults to 'debug') */
  logLevel?: string;
  /** Force pretty printing even if not TTY (default: true for tests) */
  forcePretty?: boolean;
}

/**
 * Create a logger for simulation tests.
 *
 * Similar to createBotLogger but:
 * - Always uses pretty printing by default (tests should be readable)
 * - Session ID defaults to 'test-SESSION_TIMESTAMP'
 * - Suitable for use in SimulationTest
 *
 * Returns both the logger and the log file path for assertions.
 */
export function createTestLogger(options: TestLoggerOptions): { logger: Logger; logFile: string } {
  const {
    botName,
    role,
    roleLabel = role,
    sessionId = `test-${generateSessionId()}`,
    logLevel = process.env.LOG_LEVEL || 'debug',
    forcePretty = true,
  } = options;

  const logDir = getLogDir(sessionId);
  const logFile = path.join(logDir, `${roleLabel}.log`);

  // Create file stream for JSON logs
  const fileStream = fs.createWriteStream(logFile, { flags: 'a' });

  // Create multi-destination transport
  const streams: pino.StreamEntry[] = [];

  // Pretty console output (forced for tests, or when TTY)
  if (forcePretty || process.stdout.isTTY) {
    streams.push({
      level: logLevel as pino.Level,
      stream: createPrettyStream(),
    });
  } else {
    streams.push({
      level: logLevel as pino.Level,
      stream: process.stdout,
    });
  }

  // Always write JSON to file
  streams.push({
    level: logLevel as pino.Level,
    stream: fileStream,
  });

  const logger = pino(
    {
      level: logLevel,
      base: {
        botName,
        role,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams)
  );

  return { logger, logFile };
}

/**
 * Create a simple console-only logger for the manager process.
 * This is used by src/index.ts which manages multiple bots.
 */
export function createManagerLogger(): Logger {
  const logLevel = process.env.LOG_LEVEL || 'info';
  const isPretty = process.stdout.isTTY;

  if (isPretty) {
    return pino(
      {
        level: logLevel,
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      createManagerPrettyStream()
    );
  }

  return pino({ level: logLevel });
}

/**
 * Format a JSON log line from a bot subprocess into a pretty string.
 * Used by the manager to pretty-print bot output.
 */
export function formatBotLogLine(line: string): string | null {
  // Skip empty lines
  if (!line.trim()) return null;

  // Try to parse as JSON
  try {
    const log = JSON.parse(line);

    // Check if it's a pino log (has level and time)
    if (typeof log.level !== 'number' || !log.time) {
      // Not a pino log, return as-is
      return line;
    }

    const {
      level,
      time,
      msg,
      botName,
      component,
      // Ignored fields
      role: _role,
      pid: _pid,
      hostname: _hostname,
      ...extras
    } = log;

    // Get level styling
    const levelStyle = levelConfig[level] || {
      icon: '?',
      label: 'UNKNOWN',
      color: colors.white,
    };

    // Format timestamp
    const timestamp = `${colors.dim}${formatTime(time)}${colors.reset}`;

    // Format level
    const levelStr = `${levelStyle.color}${levelStyle.icon}${colors.reset}`;

    // Format bot name badge
    let botBadge = '';
    if (botName) {
      const botColor = getBotColor(botName);
      botBadge = `${botColor.bg}${botColor.fg}${colors.bold} ${botName} ${colors.reset} `;
    }

    // Format component
    const componentStr = component
      ? `${colors.dim}[${component}]${colors.reset} `
      : '';

    // Format message
    const message = `${msg || ''}`;

    // Format extras (remaining properties)
    const extrasStr = formatExtras(extras);

    return `${timestamp} ${levelStr} ${botBadge}${componentStr}${message}${extrasStr}`;
  } catch {
    // Not JSON, return as-is with some styling for non-JSON bot output
    return `${colors.dim}│${colors.reset} ${line}`;
  }
}
