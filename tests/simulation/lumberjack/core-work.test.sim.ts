#!/usr/bin/env bun
/**
 * Lumberjack Core Work Simulation Tests
 *
 * SPECIFICATION: Lumberjack Core Work
 *
 * The lumberjack's primary responsibilities:
 * - Chop trees to gather logs
 * - Prefer forest clusters over isolated trees
 * - Ignore stumps (logs without leaves)
 * - Plant saplings for sustainability
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld, createOakTree, createStump } from '../../mocks/MockWorld';
import { LumberjackRole } from '../../../src/roles/lumberjack/LumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Chops trees in a forest
// ═══════════════════════════════════════════════════════════════════════════

async function testChopsTreesInForest() {
  const test = new SimulationTest('Chops trees in a forest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Forest cluster
  const forestCenter = new Vec3(12, 64, 12);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 4);

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

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

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Ignores stumps (logs without leaves)
// ═══════════════════════════════════════════════════════════════════════════

async function testIgnoresStumps() {
  const test = new SimulationTest('Ignores stumps');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Only stumps, no real trees
  createStump(world, new Vec3(5, 64, 5));
  createStump(world, new Vec3(-5, 64, 8));
  createStump(world, new Vec3(8, 64, -5));

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait - bot should NOT collect logs from stumps
  await test.wait(15000, 'Verifying bot ignores stumps');

  test.assertEqual(
    test.botInventoryCount('oak_log'),
    0,
    'Bot should not harvest stumps (no leaves = not a tree)'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Ignores structures with logs (villager houses)
// ═══════════════════════════════════════════════════════════════════════════

async function testIgnoresStructures() {
  const test = new SimulationTest('Ignores structures with logs');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Build a villager-style house with log pillars (no real trees!)
  // Corner pillars (vertical logs)
  for (let y = 0; y < 4; y++) {
    world.setBlock(new Vec3(5, 64 + y, 5), 'oak_log');
    world.setBlock(new Vec3(10, 64 + y, 5), 'oak_log');
    world.setBlock(new Vec3(5, 64 + y, 10), 'oak_log');
    world.setBlock(new Vec3(10, 64 + y, 10), 'oak_log');
  }

  // Walls (planks between pillars)
  for (let x = 6; x < 10; x++) {
    for (let y = 0; y < 3; y++) {
      world.setBlock(new Vec3(x, 64 + y, 5), 'oak_planks');
      world.setBlock(new Vec3(x, 64 + y, 10), 'oak_planks');
    }
  }
  for (let z = 6; z < 10; z++) {
    for (let y = 0; y < 3; y++) {
      world.setBlock(new Vec3(5, 64 + y, z), 'oak_planks');
      world.setBlock(new Vec3(10, 64 + y, z), 'oak_planks');
    }
  }

  // Roof (slabs or planks)
  for (let x = 5; x <= 10; x++) {
    for (let z = 5; z <= 10; z++) {
      world.setBlock(new Vec3(x, 68, z), 'oak_planks');
    }
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait - bot should NOT chop the house pillars
  await test.wait(15000, 'Verifying bot ignores structure');

  test.assertEqual(
    test.botInventoryCount('oak_log'),
    0,
    'Bot should not harvest logs from structures (no leaves = not a tree)'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Prefers forest clusters over isolated trees
// ═══════════════════════════════════════════════════════════════════════════

async function testPrefersForestsOverIsolated() {
  const test = new SimulationTest('Prefers forest clusters over isolated trees');

  const world = new MockWorld();
  world.fill(new Vec3(-40, 63, -40), new Vec3(40, 63, 40), 'grass_block');

  // Isolated tree nearby (at distance ~10 from spawn)
  const isolatedTreePos = new Vec3(10, 64, 0);
  createOakTree(world, isolatedTreePos, 5);

  // Forest cluster further away (at distance ~35 from spawn)
  const forestCenter = new Vec3(25, 64, 25);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 6);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);
  createOakTree(world, forestCenter.offset(2, 0, -2), 4);
  createOakTree(world, forestCenter.offset(-3, 0, -1), 5);

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
    clearRadius: 50,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to collect logs (proves it found and chopped a tree)
  await test.waitForInventory('oak_log', 1, {
    timeout: 60000,
    message: 'Bot should collect logs from a tree',
  });

  // Verify bot went to the forest, not the isolated tree
  const distToForest = test.botDistanceTo(forestCenter);
  const distToIsolated = test.botDistanceTo(isolatedTreePos);

  test.assert(
    distToForest < distToIsolated,
    `Bot should be closer to forest (dist=${distToForest.toFixed(1)}) than isolated tree (dist=${distToIsolated.toFixed(1)})`
  );

  // Verify isolated tree is still standing (base log intact)
  const isolatedTreeBase = test.blockAt(isolatedTreePos);
  test.assertEqual(
    isolatedTreeBase,
    'oak_log',
    'Isolated tree should still be standing (bot preferred forest)'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Collects dropped items
// ═══════════════════════════════════════════════════════════════════════════

async function testCollectsDrops() {
  const test = new SimulationTest('Collects dropped items');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  createOakTree(world, new Vec3(10, 64, 10), 5);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Spawn logs near the bot
  await test.rcon('summon item 2 65 2 {Item:{id:"minecraft:oak_log",count:3}}');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  await test.waitForInventory('oak_log', 3, {
    timeout: 30000,
    message: 'Bot should collect dropped oak logs',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Plants saplings for sustainability
// ═══════════════════════════════════════════════════════════════════════════

async function testPlantsSaplings() {
  const test = new SimulationTest('Plants saplings');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // One tree to chop
  createOakTree(world, new Vec3(10, 64, 10), 5);

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_sapling', count: 8 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const initialSaplings = test.botInventoryCount('oak_sapling');

  const role = new LumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to chop tree and plant saplings
  await test.waitUntil(
    () => test.botInventoryCount('oak_sapling') < initialSaplings,
    {
      timeout: 120000,
      message: 'Bot should plant saplings after chopping',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'chop': testChopsTreesInForest,
  'stumps': testIgnoresStumps,
  'structures': testIgnoresStructures,
  'forest': testPrefersForestsOverIsolated,
  'drops': testCollectsDrops,
  'saplings': testPlantsSaplings,
};

async function main() {
  const testName = process.argv[2];

  if (testName === '--list' || testName === '-l') {
    console.log('Available tests:', Object.keys(ALL_TESTS).join(', '));
    process.exit(0);
  }

  let testsToRun: Array<() => Promise<any>>;

  if (testName && ALL_TESTS[testName]) {
    testsToRun = [ALL_TESTS[testName]];
  } else if (testName) {
    console.error(`Unknown test: ${testName}`);
    process.exit(1);
  } else {
    testsToRun = Object.values(ALL_TESTS);
  }

  const { passed, failed } = await runSimulationTests(testsToRun);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
