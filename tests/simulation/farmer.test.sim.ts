#!/usr/bin/env bun
/**
 * Farmer Simulation Tests
 *
 * Automated integration tests that verify farmer bot behavior
 * against a real Paper server with actual Minecraft physics.
 *
 * Usage:
 *   bun run tests/simulation/farmer.test.sim.ts
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from './SimulationTest';
import { MockWorld } from '../mocks/MockWorld';
import { GOAPFarmingRole } from '../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer harvests mature wheat
// ═══════════════════════════════════════════════════════════════════════════

async function testHarvestsMatureWheat() {
  const test = new SimulationTest('Farmer harvests mature wheat');

  // Create a world with a small wheat farm
  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for the farm (required for hydrated farmland)
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Create farmland with mature wheat around the water
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue; // Skip water position
      const farmlandPos = new Vec3(10 + dx, 63, 10 + dz);
      const cropPos = new Vec3(10 + dx, 64, 10 + dz);
      world.setBlock(farmlandPos, 'farmland');
      world.setBlock(cropPos, 'wheat[age=7]'); // Mature wheat (age=7)
    }
  }

  // Village sign so bot knows where it is
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Farm sign pointing to the farm
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  // Load pathfinder
  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Start the farming role
  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to harvest wheat
  await test.waitForInventory('wheat', 1, {
    timeout: 90000,
    message: 'Bot should harvest at least 1 wheat',
  });

  // Verify bot collected some wheat seeds too (dropped from harvest)
  // Note: May take longer for seeds to drop and be collected
  const wheatCount = test.botInventoryCount('wheat');
  test.assertGreater(wheatCount, 0, 'Bot should have collected wheat');

  // Cleanup
  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer plants seeds on empty farmland
// ═══════════════════════════════════════════════════════════════════════════

async function testPlantsSeeds() {
  const test = new SimulationTest('Farmer plants seeds on farmland');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Create empty farmland (no crops yet)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(10 + dx, 63, 10 + dz), 'farmland');
    }
  }

  // Add grass patches around the world (for natural appearance and seed gathering if needed)
  // Patch near spawn
  for (let x = -5; x <= -2; x++) {
    for (let z = -2; z <= 2; z++) {
      if ((x + z) % 2 === 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  // Patch east of farm
  for (let x = 15; x <= 18; x++) {
    for (let z = 8; z <= 12; z++) {
      if ((x + z) % 3 !== 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to plant seeds (seed count should decrease)
  const initialSeeds = test.botInventoryCount('wheat_seeds');
  await test.waitUntil(
    () => test.botInventoryCount('wheat_seeds') < initialSeeds,
    {
      timeout: 60000,
      message: 'Bot should plant some seeds (seed count decreased)',
    }
  );

  const finalSeeds = test.botInventoryCount('wheat_seeds');
  test.assertGreater(
    initialSeeds - finalSeeds,
    0,
    `Bot should have planted seeds (${initialSeeds} -> ${finalSeeds})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer tills ground near water
// ═══════════════════════════════════════════════════════════════════════════

async function testTillsGround() {
  const test = new SimulationTest('Farmer tills ground near water');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source with dirt around it (will be tilled into farmland)
  world.setBlock(new Vec3(10, 63, 10), 'water');
  // The grass_block fill already created the surrounding area

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 20 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to till some ground (creates farmland)
  // Check for farmland blocks near the water source
  await test.waitUntil(
    () => {
      // Check for farmland in 4-block radius around water
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (dx === 0 && dz === 0) continue;
          const block = test.blockAt(new Vec3(10 + dx, 63, 10 + dz));
          if (block === 'farmland') return true;
        }
      }
      return false;
    },
    {
      timeout: 90000,
      message: 'Bot should till ground into farmland near water',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer gathers seeds from tall grass
// ═══════════════════════════════════════════════════════════════════════════

async function testGathersSeeds() {
  const test = new SimulationTest('Farmer gathers seeds from grass');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm (far from grass area to avoid interference)
  world.setBlock(new Vec3(-10, 63, -10), 'water');

  // Plant grass in patches around the map (like natural Minecraft generation)
  // Patch 1: Near spawn (5x5 area with some gaps)
  for (let x = 3; x <= 7; x++) {
    for (let z = -2; z <= 2; z++) {
      // Skip some positions for natural-looking gaps
      if ((x + z) % 3 !== 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  // Patch 2: Further east (3x3 dense cluster)
  for (let x = 12; x <= 14; x++) {
    for (let z = -1; z <= 1; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }

  // Patch 3: South area (scattered)
  for (let x = 0; x <= 8; x += 2) {
    world.setBlock(new Vec3(x, 64, 8), 'short_grass');
    world.setBlock(new Vec3(x + 1, 64, 10), 'short_grass');
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
    // No seeds - bot needs to gather them
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to gather at least a few seeds
  await test.waitForInventory('wheat_seeds', 3, {
    timeout: 120000,
    message: 'Bot should gather at least 3 wheat seeds from grass',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer collects dropped items
// ═══════════════════════════════════════════════════════════════════════════

async function testCollectsDrops() {
  const test = new SimulationTest('Farmer collects dropped items');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Spawn some wheat seeds as items near the bot
  await test.rcon('summon item 2 65 2 {Item:{id:"minecraft:wheat_seeds",count:10}}');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Bot should pick up the dropped seeds
  await test.waitForInventory('wheat_seeds', 10, {
    timeout: 30000,
    message: 'Bot should collect dropped wheat seeds',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer crafts hoe when needed
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsHoe() {
  const test = new SimulationTest('Farmer crafts hoe when needed');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Crafting table for the bot to use
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // No hoe! But materials to craft one
      { name: 'oak_planks', count: 8 },
      { name: 'stick', count: 4 },
      { name: 'wheat_seeds', count: 20 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to craft a hoe
  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_hoe'));
    },
    {
      timeout: 90000,
      message: 'Bot should craft a hoe',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer deposits produce to chest
// ═══════════════════════════════════════════════════════════════════════════

async function testDepositsToChest() {
  const test = new SimulationTest('Farmer deposits produce to chest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm center (required for farmer to work)
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Chest for deposits
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat', count: 32 },  // Produce to deposit
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const initialWheat = test.botInventoryCount('wheat');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to deposit wheat (inventory should decrease)
  await test.waitUntil(
    () => test.botInventoryCount('wheat') < initialWheat,
    {
      timeout: 60000,
      message: 'Bot should deposit wheat to chest',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN - Run all tests or specific test by name
// ═══════════════════════════════════════════════════════════════════════════

// Map test names to functions for CLI selection
const ALL_TESTS: Record<string, () => Promise<any>> = {
  'harvest': testHarvestsMatureWheat,
  'plant': testPlantsSeeds,
  'till': testTillsGround,
  'seeds': testGathersSeeds,
  'drops': testCollectsDrops,
  'hoe': testCraftsHoe,
  'deposit': testDepositsToChest,
};

async function main() {
  const testName = process.argv[2];

  if (testName === '--list' || testName === '-l') {
    console.log('Available tests:', Object.keys(ALL_TESTS).join(', '));
    process.exit(0);
  }

  let testsToRun: Array<() => Promise<any>>;

  if (testName && ALL_TESTS[testName]) {
    console.log(`Running single test: ${testName}`);
    testsToRun = [ALL_TESTS[testName]];
  } else if (testName) {
    console.error(`Unknown test: ${testName}`);
    console.error('Available tests:', Object.keys(ALL_TESTS).join(', '));
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
