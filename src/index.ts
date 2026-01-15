import { spawn, type Subprocess } from "bun";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT_PATH = resolve(__dirname, "bot.ts");

let botProcess: Subprocess | null = null;
let reconnectAttempts = 0;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
const MAX_BACKOFF = 30000;
const INITIAL_BACKOFF = 1000;

// Change to async to support waiting for process exit
async function startBot(isRestart = false) {
    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }

    if (botProcess) {
        console.log("♻️ Restarting bot due to file change...");
        
        // Signal the bot to stop (triggers the SIGTERM listener in bot.ts)
        botProcess.kill();
        
        // CRITICAL: Wait for the bot to finish dropping items and exit 
        // before spawning the new one.
        if (botProcess.exited) {
            await botProcess.exited;
        }
        
        reconnectAttempts = 0;
    } else if (!isRestart) {
        console.log("🚀 Starting bot...");
    }

    botProcess = spawn(["bun", "run", BOT_PATH], {
        stdout: "pipe",
        stderr: "inherit", // We want to see the "Dropping inventory" logs
        stdin: "inherit",
    });

    const handleStdout = async () => {
        if (!botProcess?.stdout || typeof botProcess.stdout === 'number') return;
        
        const reader = botProcess.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            process.stdout.write(text);

            if (text.includes("✅ Bot has spawned!")) {
                if (reconnectAttempts > 0) {
                    console.log("✨ Bot reconnected successfully! Resetting backoff.");
                }
                reconnectAttempts = 0;
            }
        }
    };
    handleStdout();

    const currentProcess = botProcess;
    currentProcess.exited.then((exitCode: number) => {
        if (botProcess !== currentProcess) return;

        if (exitCode !== 0 && exitCode !== null) { // exitCode is null on SIGTERM usually
            const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, reconnectAttempts), MAX_BACKOFF);
            console.log(`⚠️ Bot exited with code ${exitCode}. Reconnecting in ${delay / 1000}s...`);
            reconnectAttempts++;
            retryTimeout = setTimeout(() => {
                retryTimeout = null;
                startBot(true);
            }, delay);
        } else {
            console.log("✅ Bot exited cleanly (or was killed for restart).");
        }
    });
}

// Initial start
startBot();

console.log(`👀 Watching ${__dirname} for changes...`);
let watchTimeout: ReturnType<typeof setTimeout> | null = null;

watch(__dirname, { recursive: true }, (event, filename) => {
    if (filename && (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".json"))) {
        if (watchTimeout) clearTimeout(watchTimeout);

        watchTimeout = setTimeout(() => {
            console.log(`📝 Change detected in ${filename}`);
            // We don't set botProcess to null here anymore, 
            // we let startBot handle the kill-and-wait logic
            startBot();
        }, 100);
    }
});

process.on("SIGINT", () => {
    console.log("\n🛑 Stopping hot-reload manager...");
    if (botProcess) botProcess.kill();
    process.exit();
});