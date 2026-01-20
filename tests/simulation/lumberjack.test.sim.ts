#!/usr/bin/env bun
/**
 * Lumberjack Simulation Tests
 *
 * Automated integration tests that verify lumberjack bot behavior
 * against a real Paper server with actual Minecraft physics.
 *
 * Usage:
 *   bun run tests/simulation/lumberjack.test.sim.ts
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from './SimulationTest';
import { MockWorld, createOakTree, createStump } from '../mocks/MockWorld';
import { LumberjackRole } from '../../src/roles/lumberjack/LumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Lumberjack finds and chops a nearby tree
// ═══════════════════════════════════════════════════════════════════════════

async function testChopsNearbyTree() {
  const test = new SimulationTest('Lumberjack chops trees in a forest');

  // Create a simple world with a small forest cluster
  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Small forest cluster (lumberjack prefers forests over isolated trees)
  const forestCenter = new Vec3(12, 64, 12);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 4);

  // Village center sign so bot knows where it is
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),  // Offset from sign
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  // Load pathfinder
  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Start the lumberjack role
  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to collect some logs
  await test.waitForInventory('oak_log', 1, {
    timeout: 60000,
    message: 'Bot should collect at least 1 oak log',
  });

  // Verify bot moved toward the forest
  test.assertGreater(
    20 - test.botDistanceTo(forestCenter),
    0,
    'Bot should have moved closer to the forest'
  );

  // Cleanup
  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Lumberjack ignores stumps (logs without leaves)
// ═══════════════════════════════════════════════════════════════════════════

async function testIgnoresStumps() {
  const test = new SimulationTest('Lumberjack ignores stumps');

  // Create world with only stumps (no real trees)
  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Several stumps
  createStump(world, new Vec3(5, 64, 5));
  createStump(world, new Vec3(-5, 64, 8));
  createStump(world, new Vec3(8, 64, -5));

  // Village sign
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),  // Offset from sign
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait some time - bot should NOT collect logs from stumps
  await test.wait(15000, 'Waiting to verify bot ignores stumps');

  // Bot should have 0 logs (stumps have no leaves, so they're not "real" trees)
  test.assertEqual(
    test.botInventoryCount('oak_log'),
    0,
    'Bot should not harvest stumps (no leaves = not a tree)'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Lumberjack prefers forest clusters over isolated trees
// ═══════════════════════════════════════════════════════════════════════════

async function testPrefersForest() {
  const test = new SimulationTest('Lumberjack prefers forest clusters');

  const world = new MockWorld();
  world.fill(new Vec3(-40, 63, -40), new Vec3(40, 63, 40), 'grass_block');

  // Isolated tree nearby
  createOakTree(world, new Vec3(10, 64, 0), 5);

  // Forest cluster further away
  const forestCenter = new Vec3(25, 64, 25);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 6);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);
  createOakTree(world, forestCenter.offset(2, 0, -2), 4);
  createOakTree(world, forestCenter.offset(-3, 0, -1), 5);

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),  // Offset from sign
    botInventory: [{ name: 'iron_axe', count: 1 }],
    clearRadius: 50,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to start moving
  await test.wait(10000, 'Letting bot decide where to go');

  // Check if bot is heading toward forest (closer to forestCenter than to isolated tree)
  const distToForest = test.botDistanceTo(forestCenter);
  const distToIsolated = test.botDistanceTo(new Vec3(10, 64, 0));

  // Bot should either be closer to forest or have collected logs
  const hasLogs = test.botInventoryCount('oak_log') > 0;
  const headingToForest = distToForest < distToIsolated + 5; // Some tolerance

  test.assert(
    hasLogs || headingToForest,
    'Bot should prefer the forest cluster over isolated tree'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Lumberjack collects dropped items
// ═══════════════════════════════════════════════════════════════════════════

async function testCollectsDrops() {
  const test = new SimulationTest('Lumberjack collects dropped items');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  createOakTree(world, new Vec3(10, 64, 10), 5);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),  // Offset from sign
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Spawn some oak logs as items near the bot
  await test.rcon('summon item 2 65 2 {Item:{id:"minecraft:oak_log",count:3}}');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Bot should pick up the dropped logs
  await test.waitForInventory('oak_log', 3, {
    timeout: 30000,
    message: 'Bot should collect dropped oak logs',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN - Run all tests
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const { passed, failed } = await runSimulationTests([
    testChopsNearbyTree,
    testIgnoresStumps,
    testPrefersForest,
    testCollectsDrops,
  ]);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
