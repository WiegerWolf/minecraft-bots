import { spawn, type Subprocess } from "bun";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT_PATH = resolve(__dirname, "bot.ts");

let botProcess: Subprocess | null = null;
let reconnectAttempts = 0;
const MAX_BACKOFF = 30000; // 30 seconds
const INITIAL_BACKOFF = 1000; // 1 second

function startBot(isRestart = false) {
    if (botProcess) {
        console.log("♻️ Restarting bot due to file change...");
        botProcess.kill();
        reconnectAttempts = 0; // Reset backoff on manual/file-triggered restart
    } else if (!isRestart) {
        console.log("🚀 Starting bot...");
    }

    botProcess = spawn(["bun", "run", BOT_PATH], {
        stdout: "pipe",
        stderr: "inherit",
        stdin: "inherit",
    });

    // Handle stdout to detect successful spawn
    const handleStdout = async () => {
        if (!botProcess?.stdout) return;
        const reader = botProcess.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            process.stdout.write(text); // Still print to terminal

            if (text.includes("✅ Bot has spawned!")) {
                if (reconnectAttempts > 0) {
                    console.log("✨ Bot reconnected successfully! Resetting backoff.");
                }
                reconnectAttempts = 0;
            }
        }
    };
    handleStdout();

    botProcess.exited.then((exitCode: number) => {
        if (botProcess === null) return; // Process was killed by manager (e.g. file change)

        if (exitCode !== 0) {
            const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, reconnectAttempts), MAX_BACKOFF);
            console.log(`⚠️ Bot exited with code ${exitCode}. Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempts + 1})`);
            reconnectAttempts++;
            setTimeout(() => startBot(true), delay);
        } else {
            console.log("✅ Bot exited cleanly.");
        }
    });
}

// Initial start
startBot();

// Watch for changes in bot.ts
console.log(`👀 Watching ${BOT_PATH} for changes...`);
watch(BOT_PATH, (event, filename) => {
    if (event === "change") {
        console.log(`📝 Change detected in ${filename}`);
        const oldProcess = botProcess;
        botProcess = null; // Set to null so exited handler knows it was intentional
        if (oldProcess) oldProcess.kill();
        startBot();
    }
});

// Handle process termination
process.on("SIGINT", () => {
    console.log("\n🛑 Stopping hot-reload manager...");
    if (botProcess) botProcess.kill();
    process.exit();
});
