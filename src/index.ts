import { spawn, type Subprocess } from "bun";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT_PATH = resolve(__dirname, "bot.ts");

// Bot configurations - each entry spawns a separate bot with its own role
const BOT_CONFIGS = [
    { role: 'farming', namePrefix: 'Farmer' },
    { role: 'lumberjack', namePrefix: 'Lumberjack' },
];

// Track multiple bot processes
const botProcesses: Map<string, Subprocess> = new Map();
const reconnectAttempts: Map<string, number> = new Map();
const retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

const MAX_BACKOFF = 30000;
const INITIAL_BACKOFF = 1000;

function generateBotName(prefix: string): string {
    const suffix = Math.random().toString(36).substring(2, 6);
    return `${prefix}_${suffix}`;
}

async function startBot(config: { role: string; namePrefix: string }, isRestart = false) {
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
        console.log(`♻️ Restarting ${config.namePrefix} bot due to file change...`);
        existingProcess.kill();

        if (existingProcess.exited) {
            await existingProcess.exited;
        }
        reconnectAttempts.set(configKey, 0);
    } else if (!isRestart) {
        console.log(`🚀 Starting ${config.namePrefix} bot...`);
    }

    const botName = generateBotName(config.namePrefix);

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
                .map(line => line ? `[${config.namePrefix}] ${line}` : '')
                .join('\n');
            process.stdout.write(prefixedText);

            if (text.includes("✅ Bot has spawned!")) {
                const attempts = reconnectAttempts.get(configKey) || 0;
                if (attempts > 0) {
                    console.log(`✨ ${config.namePrefix} bot reconnected successfully! Resetting backoff.`);
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
            console.log(`⚠️ ${config.namePrefix} bot exited with code ${exitCode}. Reconnecting in ${delay / 1000}s...`);
            reconnectAttempts.set(configKey, attempts + 1);

            const timeout = setTimeout(() => {
                retryTimeouts.delete(configKey);
                startBot(config, true);
            }, delay);
            retryTimeouts.set(configKey, timeout);
        } else {
            console.log(`✅ ${config.namePrefix} bot exited cleanly (or was killed for restart).`);
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

console.log(`👀 Watching ${__dirname} for changes...`);
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
