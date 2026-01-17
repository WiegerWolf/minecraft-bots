import mineflayer, { type Bot, type BotOptions } from 'mineflayer';
import { pathfinder, goals } from 'mineflayer-pathfinder';
import { faker } from '@faker-js/faker';
import { FarmingRole } from './roles/farming/FarmingRole';
import { LumberjackRole } from './roles/lumberjack/LumberjackRole';
import { GOAPFarmingRole } from './roles/GOAPFarmingRole';
import { GOAPLumberjackRole } from './roles/GOAPLumberjackRole';
import { GOAPLandscaperRole } from './roles/GOAPLandscaperRole';
import type { Role } from './roles/Role';
const { GoalNear } = goals;

// Read configuration from environment variables (set by manager)
const BOT_ROLE = process.env.BOT_ROLE || 'farming';
const BOT_NAME = process.env.BOT_NAME || faker.internet.username().slice(0, 16);

console.log(`🎲 Bot name: ${BOT_NAME}, Role: ${BOT_ROLE}`);

const config: BotOptions = {
    host: 'localhost',
    port: 25565,
    username: BOT_NAME,
    version: undefined,
};

const bot: Bot = mineflayer.createBot(config);

bot.loadPlugin(pathfinder);

// Register all available roles
const roles: Record<string, Role> = {
    farming: new FarmingRole(),
    lumberjack: new LumberjackRole(),
    landscaper: new GOAPLandscaperRole({ debug: true }),
    'goap-farming': new GOAPFarmingRole({ debug: true }),
    'goap-lumberjack': new GOAPLumberjackRole({ debug: true }),
    'goap-landscaper': new GOAPLandscaperRole({ debug: true }),
};

let currentRole: Role | null = null;

function setRole(roleName: string | null, options?: any) {
    if (currentRole) {
        currentRole.stop(bot);
    }

    if (roleName && roles[roleName]) {
        currentRole = roles[roleName];
        currentRole.start(bot, options);
    } else {
        currentRole = null;
    }
}

bot.once('spawn', () => {
    console.log('✅ Bot has spawned!');

    // Auto-start the configured role after a short delay
    bot.waitForTicks(40).then(() => {
        console.log(`🤖 Auto-starting ${BOT_ROLE} role...`);
        setRole(BOT_ROLE);
    });
});

bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;

    const args = message.trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    // Manual role control commands (useful for debugging)
    if (command === 'farm') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'stop') {
            setRole(null);
            bot.chat("Stopped farming.");
        } else {
            const player = bot.players[username];
            const position = player?.entity?.position;
            setRole('farming', position ? { center: position } : undefined);
            bot.chat("Starting farming logic.");
        }
    }

    if (command === 'lumber' || command === 'lumberjack') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'stop') {
            setRole(null);
            bot.chat("Stopped lumberjack.");
        } else {
            setRole('lumberjack');
            bot.chat("Starting lumberjack logic.");
        }
    }

    if (command === 'landscape' || command === 'landscaper') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'stop') {
            setRole(null);
            bot.chat("Stopped landscaper.");
        } else {
            setRole('landscaper');
            bot.chat("Starting landscaper logic.");
        }
    }

    if (command === 'come') {
        const player = bot.players[username];
        const position = player?.entity?.position;
        if (position) {
            bot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, 1));
            bot.chat("Coming to you!");
        }
    }

    if (command === 'stop') {
        setRole(null);
        bot.pathfinder.stop();
        bot.chat("Stopped all activities.");
    }
});

// Track connection state explicitly
let isConnected = false;

bot.on('spawn', () => { isConnected = true; });
bot.on('kicked', (reason) => {
    isConnected = false;
    console.log('❌ Kicked:', reason);
    process.exit(1);
});
bot.on('error', (err) => {
    console.error('❌ Error:', err);
    // Don't exit on error - might be recoverable
});
bot.on('end', () => {
    isConnected = false;
    console.log('🔌 Disconnected');
    process.exit(1);
});

// Export connection check for roles to use
export function isBotConnected(): boolean {
    if (!isConnected) return false;
    // Also check if the underlying socket is alive
    try {
        const client = (bot as any)._client;
        if (!client || !client.socket || client.socket.destroyed) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}


// --- GRACEFUL SHUTDOWN LOGIC ---

let isDropping = false;

async function emergencyDropAndExit() {
    if (isDropping) return;
    isDropping = true;

    console.log("🚨 Termination signal received. Initiating emergency inventory dump...");

    // 1. Stop all bot actions
    setRole(null);
    bot.pathfinder.stop();
    bot.clearControlStates();

    // 2. Drop everything
    const items = bot.inventory.items();
    if (items.length > 0) {
        try {
            // Look down to drop at feet
            await bot.look(bot.entity.yaw, -Math.PI / 2, true);

            for (const item of items) {
                try {
                    await bot.tossStack(item);
                } catch (e) {
                    console.error(`Failed to drop ${item.name}`);
                }
            }
        } catch (e) {
            console.error("Error during drop sequence:", e);
        }
    }

    console.log("👋 Inventory cleared. Exiting now.");
    process.exit(0);
}

// Listen for kill signals from the manager
process.on('SIGINT', emergencyDropAndExit);
process.on('SIGTERM', emergencyDropAndExit);
