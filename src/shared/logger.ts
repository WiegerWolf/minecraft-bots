import pino from 'pino';
import fs from 'fs';
import path from 'path';

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  botName: string;
  role: string;
}

/**
 * Type alias for the logger instance.
 */
export type Logger = pino.Logger;

/**
 * Get the log directory for today's date.
 * Creates the directory if it doesn't exist.
 */
function getLogDir(): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const logDir = path.join(process.cwd(), 'logs', date!);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return logDir;
}

/**
 * Create a logger instance for a bot.
 *
 * Outputs to both:
 * - stdout (with pino-pretty for readable console output)
 * - log file in logs/YYYY-MM-DD/BotName.log (JSON format for grep/analysis)
 */
export function createBotLogger(options: LoggerOptions): Logger {
  const { botName, role } = options;
  const logLevel = process.env.LOG_LEVEL || 'debug';

  const logDir = getLogDir();
  const logFile = path.join(logDir, `${botName}.log`);

  // Create file stream for JSON logs
  const fileStream = fs.createWriteStream(logFile, { flags: 'a' });

  // Determine if we should use pretty printing (development)
  const isPretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;

  // Create multi-destination transport
  const streams: pino.StreamEntry[] = [];

  if (isPretty) {
    // Pretty console output in development
    streams.push({
      level: logLevel as pino.Level,
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '[{component}] {msg}',
        },
      }),
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
 * Create a simple console-only logger for the manager process.
 * This is used by src/index.ts which manages multiple bots.
 */
export function createManagerLogger(): Logger {
  const logLevel = process.env.LOG_LEVEL || 'info';
  const isPretty = process.stdout.isTTY;

  if (isPretty) {
    return pino({
      level: logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({ level: logLevel });
}
