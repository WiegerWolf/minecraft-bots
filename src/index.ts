import { spawn, type Subprocess } from "bun";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { faker } from '@faker-js/faker';
import { createManagerLogger, formatBotLogLine, generateSessionId } from './shared/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Manager logger
const log = createManagerLogger();

// Session ID for all logs from this run
const sessionId = generateSessionId();
log.info({ sessionId }, 'Starting session');

const BOT_PATH = resolve(__dirname, "bot.ts");

// Bot configurations - each entry spawns a separate bot with its own role
// roleLabel must be short to fit within Minecraft's 16 character username limit
const ALL_BOT_CONFIGS = [
    { role: 'goap-farming', roleLabel: 'Farmer', aliases: ['farmer', 'farm'] },
    { role: 'goap-lumberjack', roleLabel: 'Lmbr', aliases: ['lumberjack', 'lumber', 'lmbr'] },
    { role: 'landscaper', roleLabel: 'Land', aliases: ['landscaper', 'land'] },
];

/**
 * Parse CLI arguments to determine which bot(s) to launch.
 * Usage: bun run start [bot-alias]
 *
 * Examples:
 *   bun run start           -> launches all bots
 *   bun run start farmer    -> launches only farmer bot
 *   bun run start lumberjack -> launches only lumberjack bot
 */
function parseBotSelection(): typeof ALL_BOT_CONFIGS {
    const args = process.argv.slice(2); // Skip 'bun' and script path

    if (args.length === 0) {
        // No arguments: launch all bots
        return ALL_BOT_CONFIGS;
    }

    const alias = args[0]!.toLowerCase();

    // Find matching bot config
    const matchedConfig = ALL_BOT_CONFIGS.find(config =>
        config.aliases.includes(alias) || config.role === alias
    );

    if (!matchedConfig) {
        log.error({ alias, available: ALL_BOT_CONFIGS.map(c => c.aliases.join('/')) }, 'Unknown bot');
        process.exit(1);
    }

    return [matchedConfig];
}

// Determine which bots to launch based on CLI args
const BOT_CONFIGS = parseBotSelection();

// Track multiple bot processes
const botProcesses: Map<string, Subprocess> = new Map();
const reconnectAttempts: Map<string, number> = new Map();
const retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

const MAX_BACKOFF = 30000;
const INITIAL_BACKOFF = 1000;

/**
 * Generate a bot name using faker with the role label.
 * Format: FirstName_RoleLabel (e.g., "Emma_Farmer", "Oscar_Lmbr")
 * Must fit within Minecraft's 16 character username limit.
 */
function generateBotName(roleLabel: string): string {
    // Calculate max length for first name (16 chars total - underscore - role label)
    const maxFirstNameLen = 16 - roleLabel.length - 1;

    // Get a first name and truncate if needed
    let firstName = faker.person.firstName();
    firstName = firstName.substring(0, maxFirstNameLen).replace(/[^a-zA-Z0-9]/g, '');

    return `${firstName}_${roleLabel}`;
}

async function startBot(config: { role: string; roleLabel: string }, isRestart = false) {
    const configKey = config.role;

    // Clear any pending retry
    const existingTimeout = retryTimeouts.get(configKey);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        retryTimeouts.delete(configKey);
    }

    // Kill existing bot if restarting
    const existingProcess = botProcesses.get(configKey);
    if (existingProcess) {
        log.info({ bot: config.roleLabel }, 'Restarting bot due to file change');
        existingProcess.kill();

        if (existingProcess.exited) {
            await existingProcess.exited;
        }
        reconnectAttempts.set(configKey, 0);
    } else if (!isRestart) {
        log.info({ bot: config.roleLabel }, 'Starting bot');
    }

    const botName = generateBotName(config.roleLabel);

    const botProcess = spawn(["bun", "run", BOT_PATH], {
        stdout: "pipe",
        stderr: "inherit",
        stdin: "inherit",
        env: {
            ...process.env,
            BOT_ROLE: config.role,
            BOT_NAME: botName,
            ROLE_LABEL: config.roleLabel,
            SESSION_ID: sessionId,
        },
    });

    botProcesses.set(configKey, botProcess);

    // Handle stdout - pretty print JSON logs from bots
    const handleStdout = async () => {
        if (!botProcess?.stdout || typeof botProcess.stdout === 'number') return;

        const reader = botProcess.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line) continue;

                // Check for spawn marker (may be plain text)
                if (line.includes("✅ Bot has spawned!")) {
                    const attempts = reconnectAttempts.get(configKey) || 0;
                    if (attempts > 0) {
                        log.info({ bot: config.roleLabel }, 'Bot reconnected successfully, resetting backoff');
                    }
                    reconnectAttempts.set(configKey, 0);
                }

                // Format and output
                const formatted = formatBotLogLine(line);
                if (formatted) {
                    process.stdout.write(formatted + '\n');
                }
            }
        }

        // Handle any remaining buffer
        if (buffer) {
            const formatted = formatBotLogLine(buffer);
            if (formatted) {
                process.stdout.write(formatted + '\n');
            }
        }
    };
    handleStdout();

    // Handle exit
    const currentProcess = botProcess;
    currentProcess.exited.then((exitCode: number) => {
        if (botProcesses.get(configKey) !== currentProcess) return;

        if (exitCode !== 0 && exitCode !== null) {
            const attempts = reconnectAttempts.get(configKey) || 0;
            const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, attempts), MAX_BACKOFF);
            log.warn({ bot: config.roleLabel, exitCode, delaySeconds: delay / 1000 }, 'Bot exited, reconnecting');
            reconnectAttempts.set(configKey, attempts + 1);

            const timeout = setTimeout(() => {
                retryTimeouts.delete(configKey);
                startBot(config, true);
            }, delay);
            retryTimeouts.set(configKey, timeout);
        } else {
            log.info({ bot: config.roleLabel }, 'Bot exited cleanly');
        }
    });
}

// Start all bots with a small delay between them to avoid connection race conditions
async function startAllBots() {
    for (let i = 0; i < BOT_CONFIGS.length; i++) {
        const config = BOT_CONFIGS[i]!;
        await startBot(config);
        // Small delay between bot spawns to avoid server connection issues
        if (i < BOT_CONFIGS.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Initial start
startAllBots();

const botCount = BOT_CONFIGS.length;
const botNames = BOT_CONFIGS.map(c => c.roleLabel).join(', ');
log.info({ directory: __dirname, botCount, bots: botNames }, 'Watching for changes');
let watchTimeout: ReturnType<typeof setTimeout> | null = null;

watch(__dirname, { recursive: true }, (event, filename) => {
    if (filename && (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".json"))) {
        // Ignore changes to village.json (shared state file)
        if (filename.includes('village.json')) return;

        if (watchTimeout) clearTimeout(watchTimeout);

        watchTimeout = setTimeout(async () => {
            log.info({ filename }, 'Change detected');
            // Restart all bots on file change
            for (const config of BOT_CONFIGS) {
                await startBot(config);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }, 100);
    }
});

process.on("SIGINT", () => {
    log.info('Stopping hot-reload manager');
    for (const [role, proc] of botProcesses) {
        log.info({ role }, 'Killing bot');
        proc.kill();
    }
    process.exit();
});
