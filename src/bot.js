import mineflayer from 'mineflayer';

// Bot configuration
const config = {
  host: 'localhost',     // Minecraft server address
  port: 25565,           // Minecraft server port
  username: 'Bot',       // Bot username (for offline mode)
  // auth: 'microsoft', // Uncomment for online/premium servers
  version: false,        // Auto-detect server version
};

// Create the bot
const bot = mineflayer.createBot(config);

// Event: Bot spawned into the world
bot.on('spawn', () => {
  console.log('✅ Bot has spawned!');
  console.log(`📍 Position: ${bot.entity.position}`);
});

// Event: Chat messages
bot.on('chat', (username, message) => {
  if (username === bot.username) return; // Ignore own messages

  console.log(`💬 ${username}: ${message}`);

  // Simple command handling
  if (message === 'hello') {
    bot.chat(`Hello, ${username}!`);
  }

  if (message === 'come') {
    const player = bot.players[username];
    if (player && player.entity) {
      bot.chat(`Coming to you, ${username}!`);
      bot.pathfinder?.goto(player.entity.position);
    }
  }
});

// Event: Bot kicked from server
bot.on('kicked', (reason) => {
  console.log('❌ Bot was kicked:', reason);
});

// Event: Connection error
bot.on('error', (err) => {
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
