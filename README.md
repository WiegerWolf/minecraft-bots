# Minecraft Bots

A Minecraft bot built with [Mineflayer](https://github.com/PrismarineJS/mineflayer).

## Setup

Install dependencies:

```bash
bun install
```

## Usage

1. Start a Minecraft server (local or remote)
2. Update the configuration in `src/bot.js` if needed
3. Run the bot:

```bash
bun start
```

For development with auto-reload:

```bash
bun dev
```

## Configuration

Edit the `config` object in `src/bot.js`:

- `host` - Server address (default: `localhost`)
- `port` - Server port (default: `25565`)
- `username` - Bot username for offline mode
- `auth` - Set to `'microsoft'` for online/premium servers

## Bot Commands

Chat these in-game:

- `hello` - Bot responds with a greeting
- `come` - Bot moves toward you (requires pathfinder plugin)
