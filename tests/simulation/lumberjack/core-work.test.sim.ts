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
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

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

  const role = new GOAPLumberjackRole();
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

  const role = new GOAPLumberjackRole();
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

  const role = new GOAPLumberjackRole();
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

  const role = new GOAPLumberjackRole();
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
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Spread 10 logs across the map at various distances from the bot
  const logPositions = [
    { x: 8, z: 0 },    // East
    { x: -8, z: 0 },   // West
    { x: 0, z: 8 },    // South
    { x: 0, z: -8 },   // North
    { x: 6, z: 6 },    // SE
    { x: -6, z: 6 },   // SW
    { x: 6, z: -6 },   // NE
    { x: -6, z: -6 },  // NW
    { x: 10, z: 5 },   // Far east
    { x: -10, z: -5 }, // Far west
  ];

  for (const pos of logPositions) {
    await test.rcon(`summon item ${pos.x} 64 ${pos.z} {Item:{id:"minecraft:oak_log",count:1}}`);
  }

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  await test.waitForInventory('oak_log', 10, {
    timeout: 60000,
    message: 'Bot should collect all 10 scattered oak logs',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Plants saplings for sustainability
// ═══════════════════════════════════════════════════════════════════════════

async function testPlantsSaplings() {
  const test = new SimulationTest('Plants saplings with proper spacing');

  const world = new MockWorld();
  // Large area for planting multiple saplings with 5-block spacing
  world.fill(new Vec3(-40, 63, -40), new Vec3(40, 63, 40), 'grass_block');

  // Signs to establish village and forest location (forest is 25 blocks away)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(0, 64, 1), 'oak_sign', { signText: '[FOREST]\nX: 25\nY: 64\nZ: 25' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_sapling', count: 10 },
    ],
    clearRadius: 80,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const initialSaplings = test.botInventoryCount('oak_sapling');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to plant at least 5 saplings
  const minSaplingsToPlant = 5;
  await test.waitUntil(
    () => test.botInventoryCount('oak_sapling') <= initialSaplings - minSaplingsToPlant,
    {
      timeout: 120000,
      message: `Bot should plant at least ${minSaplingsToPlant} saplings`,
    }
  );

  role.stop(test.bot);

  // Count planted saplings in the world and verify spacing
  const plantedSaplings: Vec3[] = [];
  for (let x = -40; x <= 40; x++) {
    for (let z = -40; z <= 40; z++) {
      const block = test.blockAt(new Vec3(x, 64, z));
      if (block && block.includes('sapling')) {
        plantedSaplings.push(new Vec3(x, 64, z));
      }
    }
  }

  test.assertGreater(
    plantedSaplings.length,
    minSaplingsToPlant - 1,
    `Should have planted at least ${minSaplingsToPlant} saplings in the world (found ${plantedSaplings.length})`
  );

  // Verify spacing between saplings (minimum 5 blocks apart)
  const minSpacing = 5;
  let spacingValid = true;
  for (let i = 0; i < plantedSaplings.length; i++) {
    for (let j = i + 1; j < plantedSaplings.length; j++) {
      const dist = plantedSaplings[i]!.distanceTo(plantedSaplings[j]!);
      if (dist < minSpacing) {
        spacingValid = false;
        console.log(`  ✗ Saplings too close: ${plantedSaplings[i]} and ${plantedSaplings[j]} (${dist.toFixed(1)} blocks)`);
      }
    }
  }

  test.assert(spacingValid, `All saplings should be at least ${minSpacing} blocks apart`);

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
