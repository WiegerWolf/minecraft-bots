#!/usr/bin/env bun
/**
 * Full Lumberjack Simulation with Paper Server (Real Physics)
 *
 * This runs your actual LumberjackRole against a real Paper Minecraft server,
 * giving you accurate physics, pathfinding, and game mechanics.
 *
 * Prerequisites:
 *   - First run: bun install (to get rcon-client)
 *   - Server will auto-start, or manually: cd server && ./start.sh
 *
 * Usage:
 *   bun run tests/simulation/run-lumberjack-paper.sim.ts
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { PaperSimulationServer } from './PaperSimulationServer';
import { MockWorld, createOakTree, createStump } from '../mocks/MockWorld';
import { LumberjackRole } from '../../src/roles/lumberjack/LumberjackRole';
import { createBotLogger, generateSessionId } from '../../src/shared/logger';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   LUMBERJACK SIMULATION - Paper Server (Real Physics)     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1. CREATE THE WORLD
  // ═══════════════════════════════════════════════════════════════════════
  const world = new MockWorld();

  // Ground layer
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // === VILLAGE CENTER ===
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // === FOREST AREA ===
  createOakTree(world, new Vec3(15, 64, 15), 5);
  createOakTree(world, new Vec3(18, 64, 12), 6);
  createOakTree(world, new Vec3(12, 64, 18), 5);
  createOakTree(world, new Vec3(20, 64, 20), 4);
  createOakTree(world, new Vec3(22, 64, 16), 5);

  // === STUMPS ===
  createStump(world, new Vec3(-10, 64, 10));
  createStump(world, new Vec3(-8, 64, 12));
  createStump(world, new Vec3(-12, 64, 8));

  // === STORAGE CHEST ===
  world.setBlock(new Vec3(2, 64, -2), 'chest');

  // === WOODEN STRUCTURE (should NOT be harvested) ===
  world.fill(new Vec3(-5, 64, -10), new Vec3(0, 64, -8), 'oak_planks');
  world.setBlock(new Vec3(-5, 65, -10), 'oak_log');
  world.setBlock(new Vec3(0, 65, -10), 'oak_log');
  world.setBlock(new Vec3(-5, 65, -8), 'oak_log');
  world.setBlock(new Vec3(0, 65, -8), 'oak_log');

  console.log('World defined:');
  console.log('  📍 Village center sign at (0, 64, 0)');
  console.log('  🌲 5 oak trees at (12-22, 64, 12-20)');
  console.log('  🪵 3 stumps at (-12 to -8, 64, 8-12)');
  console.log('  📦 Chest at (2, 64, -2)');
  console.log('  🏠 Wooden structure at (-5 to 0, 64-65, -10 to -8)');
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // 2. START THE SIMULATION
  // ═══════════════════════════════════════════════════════════════════════
  const sim = new PaperSimulationServer();

  const bot = await sim.start(world, {
    botPosition: new Vec3(0, 65, 0),
    botInventory: [
      { name: 'iron_axe', count: 1 },
    ],
    gameMode: 'survival',
    viewerPort: 3000,
    firstPerson: false,
    openBrowser: true,
    autoStartServer: true,  // Will start Paper if not running
    clearWorld: true,       // Clear area before building
    clearRadius: 40,
  });

  console.log('\nServer ready, bot connected');
  console.log('  🤖 Bot at (0, 65, 0)');
  console.log('  🪓 Inventory: iron_axe x1');
  console.log('  🌐 Viewer: http://localhost:3000');
  console.log('  🎮 Join with Minecraft client: localhost:25566 (auto-op enabled)');
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // 3. SET UP THE BOT
  // ═══════════════════════════════════════════════════════════════════════

  // Load pathfinder plugin
  bot.loadPlugin(pathfinderPlugin);

  // Wait for chunks to load
  console.log('Waiting for world to load...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Create logger
  const logger = createBotLogger({
    botName: 'SimBot',
    role: 'lumberjack',
    roleLabel: 'SimLumberjack',
    sessionId: generateSessionId(),
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. START THE LUMBERJACK ROLE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n▶ Starting LumberjackRole...\n');

  const role = new LumberjackRole();
  role.start(bot, { logger });

  // Log events
  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      console.log(`💬 [${username}] ${message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. KEEP RUNNING
  // ═══════════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Simulation running with REAL MINECRAFT PHYSICS!');
  console.log('');
  console.log('Watch the bot in:');
  console.log('  - Browser viewer: http://localhost:3000');
  console.log('  - Real Minecraft client: localhost:25566');
  console.log('');
  console.log('Expected behavior:');
  console.log('  1. Bot reads the VILLAGE CENTER sign');
  console.log('  2. Bot detects forest at (12-22, 64, 12-20)');
  console.log('  3. Bot walks to forest and chops trees');
  console.log('  4. Bot ignores stumps and structure');
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('═══════════════════════════════════════════════════════════════');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    role.stop(bot);
    await sim.stop();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
