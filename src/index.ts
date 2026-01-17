import { spawn, type Subprocess } from "bun";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { faker } from '@faker-js/faker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        console.error(`Unknown bot: "${alias}"`);
        console.error(`Available bots: ${ALL_BOT_CONFIGS.map(c => c.aliases.join('/')).join(', ')}`);
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
        console.log(`♻️ Restarting ${config.roleLabel} bot due to file change...`);
        existingProcess.kill();

        if (existingProcess.exited) {
            await existingProcess.exited;
        }
        reconnectAttempts.set(configKey, 0);
    } else if (!isRestart) {
        console.log(`🚀 Starting ${config.roleLabel} bot...`);
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
        },
    });

    botProcesses.set(configKey, botProcess);

    // Handle stdout
    const handleStdout = async () => {
        if (!botProcess?.stdout || typeof botProcess.stdout === 'number') return;

        const reader = botProcess.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            // Prefix output with bot role for clarity
            const prefixedText = text.split('\n')
                .map(line => line ? `[${config.roleLabel}] ${line}` : '')
                .join('\n');
            process.stdout.write(prefixedText);

            if (text.includes("✅ Bot has spawned!")) {
                const attempts = reconnectAttempts.get(configKey) || 0;
                if (attempts > 0) {
                    console.log(`✨ ${config.roleLabel} bot reconnected successfully! Resetting backoff.`);
                }
                reconnectAttempts.set(configKey, 0);
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
            console.log(`⚠️ ${config.roleLabel} bot exited with code ${exitCode}. Reconnecting in ${delay / 1000}s...`);
            reconnectAttempts.set(configKey, attempts + 1);

            const timeout = setTimeout(() => {
                retryTimeouts.delete(configKey);
                startBot(config, true);
            }, delay);
            retryTimeouts.set(configKey, timeout);
        } else {
            console.log(`✅ ${config.roleLabel} bot exited cleanly (or was killed for restart).`);
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
console.log(`👀 Watching ${__dirname} for changes... (${botCount} bot${botCount > 1 ? 's' : ''}: ${botNames})`);
let watchTimeout: ReturnType<typeof setTimeout> | null = null;

watch(__dirname, { recursive: true }, (event, filename) => {
    if (filename && (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".json"))) {
        // Ignore changes to village.json (shared state file)
        if (filename.includes('village.json')) return;

        if (watchTimeout) clearTimeout(watchTimeout);

        watchTimeout = setTimeout(async () => {
            console.log(`📝 Change detected in ${filename}`);
            // Restart all bots on file change
            for (const config of BOT_CONFIGS) {
                await startBot(config);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }, 100);
    }
});

process.on("SIGINT", () => {
    console.log("\n🛑 Stopping hot-reload manager...");
    for (const [role, process] of botProcesses) {
        console.log(`  Killing ${role} bot...`);
        process.kill();
    }
    process.exit();
});
