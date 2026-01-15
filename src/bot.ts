import mineflayer, { type Bot, type BotOptions } from 'mineflayer';
import { pathfinder, goals } from 'mineflayer-pathfinder';
import { faker } from '@faker-js/faker';
import { FarmingRole } from './roles/FarmingRole';
import type { Role } from './roles/Role';

const { GoalNear } = goals;

// Generate a random bot name (max 16 characters for Minecraft)
const botName = faker.internet.username().slice(0, 16);
console.log(`🎲 Generated random name: ${botName}`);

// Bot configuration
const config: BotOptions = {
    host: 'localhost',     // Minecraft server address
    port: 25565,           // Minecraft server port
    username: botName,     // Bot username (for offline mode)
    // auth: 'microsoft', // Uncomment for online/premium servers
    version: undefined,    // Auto-detect server version
};

// Create the bot
const bot: Bot = mineflayer.createBot(config);

bot.loadPlugin(pathfinder);

// Role management
const roles: Record<string, Role> = {
    farming: new FarmingRole()
};
let currentRole: Role | null = null;

function setRole(roleName: string | null) {
    if (currentRole) {
        currentRole.stop(bot);
    }

    if (roleName && roles[roleName]) {
        currentRole = roles[roleName];
        currentRole.start(bot);
    } else {
        currentRole = null;
    }
}

let hasInitialized = false;

// Event: Bot spawned into the world
bot.on('spawn', () => {
    console.log('✅ Bot has spawned!');
    console.log(`📍 Position: ${bot.entity?.position || 'unknown'}`);

    if (!hasInitialized) {
        hasInitialized = true;

        // Auto-run to the nearest player after a brief delay (to let entities load)
        setTimeout(() => {
            const target = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
            if (target) {
                console.log(`🏃 Found ${target.username}, running to them!`);
                bot.chat(`Coming to you, ${target.username}!`);
                const pos = target.position;
                bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 1));
            } else {
                console.log('🤷 No players found nearby to run to.');
            }
        }, 2000);

        // Periodically update the current role
        setInterval(() => {
            if (currentRole) {
                currentRole.update(bot);
            }
        }, 500);
    }
});

// Event: Chat messages
bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return; // Ignore own messages

    console.log(`💬 ${username}: ${message}`);

    const args = message.trim().split(/\s+/);
    const command = args[0]?.toLowerCase();
    if (!command) return;

    // Simple command handling
    if (command === 'hello') {
        bot.chat(`Hello, ${username}!`);
    }

    if (command === 'come') {
        const player = bot.players[username];
        if (player?.entity && bot.entity?.position) { // Added null check for bot.entity.position
            const pos = player.entity.position;
            bot.chat(`Coming to you, ${username}!`);
            bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 1));
        } else if (!bot.entity?.position) {
            bot.chat("I don't know where I am right now!");
        }
    }

    if (command === 'farm') {
        const subCommand = args[1]?.toLowerCase();
        if (subCommand === 'stop') {
            setRole(null);
        } else {
            // Default to start if no subcommand or 'start'
            setRole('farming');
        }
    }
});

// Event: Bot kicked from server
bot.on('kicked', (reason: string) => {
    console.log('❌ Bot was kicked:', reason);
    process.exit(1);
});

// Event: Connection error
bot.on('error', (err: Error) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});

// Event: Bot disconnected
bot.on('end', () => {
    console.log('🔌 Bot disconnected');
    process.exit(1);
});

// Log when bot is ready
bot.once('login', () => {
    console.log('🎮 Bot logged in successfully!');
});

