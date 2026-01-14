import { spawn, type Subprocess } from "bun";
import { watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT_PATH = resolve(__dirname, "bot.ts");

let botProcess: Subprocess | null = null;

function startBot() {
    if (botProcess) {
        console.log("♻️ Restarting bot...");
        botProcess.kill();
    } else {
        console.log("🚀 Starting bot...");
    }

    botProcess = spawn(["bun", "run", BOT_PATH], {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
    });

    botProcess.exited.then((exitCode: number) => {
        if (exitCode !== 0 && botProcess !== null) {
            console.log(`⚠️ Bot exited with code ${exitCode}. Waiting for changes to restart...`);
        } else if (exitCode === 0) {
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
        startBot();
    }
});

// Handle process termination
process.on("SIGINT", () => {
    console.log("\n🛑 Stopping hot-reload manager...");
    if (botProcess) botProcess.kill();
    process.exit();
});
