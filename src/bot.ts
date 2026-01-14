import mineflayer, { type Bot, type BotOptions } from 'mineflayer';
import { pathfinder, goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

// Bot configuration
const config: BotOptions = {
    host: 'localhost',     // Minecraft server address
    port: 25565,           // Minecraft server port
    username: 'Bot',       // Bot username (for offline mode)
    // auth: 'microsoft', // Uncomment for online/premium servers
    version: undefined,    // Auto-detect server version
};

// Create the bot
const bot: Bot = mineflayer.createBot(config);

bot.loadPlugin(pathfinder);

// Event: Bot spawned into the world
bot.on('spawn', () => {
    console.log('✅ Bot has spawned!');
    console.log(`📍 Position: ${bot.entity.position}`);
});

// Event: Chat messages
bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return; // Ignore own messages

    console.log(`💬 ${username}: ${message}`);

    // Simple command handling
    if (message === 'hello') {
        bot.chat(`Hello, ${username}!`);
    }

    if (message === 'come') {
        const player = bot.players[username];
        if (player?.entity) {
            const pos = player.entity.position;
            bot.chat(`Coming to you, ${username}!`);
            bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 1));
        }
    }
});

// Event: Bot kicked from server
bot.on('kicked', (reason: string) => {
    console.log('❌ Bot was kicked:', reason);
});

// Event: Connection error
bot.on('error', (err: Error) => {
    console.error('❌ Error:', err.message);
});

// Event: Bot disconnected
bot.on('end', () => {
    console.log('🔌 Bot disconnected');
});

// Log when bot is ready
bot.once('login', () => {
    console.log('🎮 Bot logged in successfully!');
});
