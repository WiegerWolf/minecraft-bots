#!/usr/bin/env bun
/**
 * Example Simulation: Lumberjack in a Forest
 *
 * This demonstrates how to use LiveSimulationServer to test bot behavior
 * in a controlled but real Minecraft environment.
 *
 * Usage:
 *   bun run tests/simulation/example-lumberjack.sim.ts
 *
 * What this does:
 *   1. Creates a small forest world (grass + oak trees)
 *   2. Spawns a bot with an axe
 *   3. Opens prismarine-viewer to watch
 *   4. You can then manually trigger bot actions or hook up GOAP
 */

import { Vec3 } from 'vec3';
import { LiveSimulationServer } from './LiveSimulationServer';
import { MockWorld, createOakTree, createStump } from '../mocks/MockWorld';

async function main() {
  console.log('=== Lumberjack Simulation ===\n');

  // 1. Create the world
  const world = new MockWorld();

  // Ground layer
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Add some trees
  createOakTree(world, new Vec3(5, 64, 5), 5);
  createOakTree(world, new Vec3(-5, 64, 8), 6);
  createOakTree(world, new Vec3(10, 64, -3), 5);
  createOakTree(world, new Vec3(-8, 64, -6), 4);

  // Add a couple stumps (already harvested)
  createStump(world, new Vec3(0, 64, 10));
  createStump(world, new Vec3(12, 64, 8));

  // Add some structure (a simple platform - should not be harvested)
  world.fill(new Vec3(-3, 64, -15), new Vec3(3, 64, -12), 'oak_planks');

  console.log('World created:');
  console.log('  - 4 oak trees');
  console.log('  - 2 stumps');
  console.log('  - 1 wooden platform (should be ignored)\n');

  // 2. Start the simulation
  const sim = new LiveSimulationServer();

  const bot = await sim.start(world, {
    botPosition: new Vec3(0, 65, 0),
    botInventory: [
      { name: 'diamond_axe', count: 1 },
    ],
    gameMode: 'survival',
    viewerPort: 3000,
    firstPerson: false, // Bird's eye view
    openBrowser: true,
  });

  console.log('Simulation started!');
  console.log('  - Bot spawned at (0, 65, 0)');
  console.log('  - Bot has: diamond_axe');
  console.log('  - Viewer: http://localhost:3000\n');

  // 3. Set up basic bot logging
  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      console.log(`[Chat] ${username}: ${message}`);
    }
  });

  bot.on('health', () => {
    console.log(`[Bot] Health: ${bot.health}, Food: ${bot.food}`);
  });

  // 4. Simple interaction loop
  console.log('Bot is ready. You can:');
  console.log('  - Watch in the browser viewer');
  console.log('  - The bot is idle (no GOAP loop running yet)');
  console.log('  - Press Ctrl+C to stop\n');

  // Keep the process running
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await sim.stop();
    process.exit(0);
  });

  // Example: Make the bot look around slowly
  let angle = 0;
  setInterval(() => {
    if (bot.entity) {
      angle += 0.1;
      bot.look(angle, 0, false);
    }
  }, 100);

  // Keep alive
  await new Promise(() => {}); // Never resolves - keeps process running
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
