import mineflayer, { type Bot, type BotOptions } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { faker } from '@faker-js/faker';
import { FarmingRole } from './roles/farming/FarmingRole';
import type { Role } from './roles/Role';

// Generate a random bot name
const botName = faker.internet.username().slice(0, 16);
console.log(`🎲 Generated random name: ${botName}`);

const config: BotOptions = {
    host: 'localhost',
    port: 25565,
    username: botName,
    version: undefined,
};

const bot: Bot = mineflayer.createBot(config);

bot.loadPlugin(pathfinder);

const roles: Record<string, Role> = {
    farming: new FarmingRole()
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
    
    bot.waitForTicks(20).then(() => {
         bot.chat('Ready to work!');
    });
});

bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;

    const args = message.trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

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
});

bot.on('kicked', (reason) => { console.log('❌ Kicked:', reason); process.exit(1); });
bot.on('error', (err) => { console.error('❌ Error:', err); });
bot.on('end', () => { console.log('🔌 Disconnected'); process.exit(1); });


// --- GRACEFUL SHUTDOWN LOGIC ---

let isDropping = false;

async function emergencyDropAndExit() {
    if (isDropping) return;
    isDropping = true;

    console.log("🚨 Termination signal received. Initiating emergency inventory dump...");
    bot.chat("Shutting down! Dropping inventory...");

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