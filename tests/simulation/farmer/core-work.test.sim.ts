#!/usr/bin/env bun
/**
 * Farmer Core Work Simulation Tests
 *
 * SPECIFICATION: Farmer Core Work
 *
 * The farmer's primary responsibilities:
 * - Harvest mature crops
 * - Plant seeds on available farmland
 * - Till ground to create farmland
 * - Gather seeds when needed
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Harvests mature wheat
// ═══════════════════════════════════════════════════════════════════════════

async function testHarvestsMatureWheat() {
  const test = new SimulationTest('Harvests mature wheat (selective)');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for the farm
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Create farmland with mixed-age wheat (mature and immature)
  // Track positions for later verification
  let matureCount = 0;
  const immaturePositions: Vec3[] = [];

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(10 + dx, 63, 10 + dz), 'farmland');

      // Checkerboard pattern: alternating mature (age=7) and immature (age=3)
      const isMature = (dx + dz) % 2 === 0;
      if (isMature) {
        world.setBlock(new Vec3(10 + dx, 64, 10 + dz), 'wheat[age=7]');
        matureCount++;
      } else {
        world.setBlock(new Vec3(10 + dx, 64, 10 + dz), 'wheat[age=3]');
        immaturePositions.push(new Vec3(10 + dx, 64, 10 + dz));
      }
    }
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to harvest most of the mature wheat
  // Expect at least 80% of mature crops harvested (accounting for drop RNG)
  const expectedMinWheat = Math.floor(matureCount * 0.8);
  await test.waitForInventory('wheat', expectedMinWheat, {
    timeout: 90000,
    message: `Bot should harvest at least ${expectedMinWheat} wheat (from ${matureCount} mature crops)`,
  });

  const wheatCount = test.botInventoryCount('wheat');
  test.assertGreater(wheatCount, expectedMinWheat - 1, `Bot should have harvested most mature wheat (got ${wheatCount})`);

  // Verify immature wheat was NOT harvested - blocks should still exist
  let immatureRemaining = 0;
  for (const pos of immaturePositions) {
    const block = test.blockAt(pos);
    if (block?.startsWith('wheat')) {
      immatureRemaining++;
    }
  }
  test.assertGreater(
    immatureRemaining,
    immaturePositions.length * 0.8,
    `Immature wheat should remain unharvested (${immatureRemaining}/${immaturePositions.length} still growing)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Plants seeds on empty farmland
// ═══════════════════════════════════════════════════════════════════════════

async function testPlantsSeeds() {
  const test = new SimulationTest('Plants seeds on farmland');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Create empty farmland (no crops yet)
  // Track farmland positions for verification
  const farmlandPositions: Vec3[] = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(10 + dx, 63, 10 + dz), 'farmland');
      farmlandPositions.push(new Vec3(10 + dx, 64, 10 + dz)); // y+1 for crop position
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

  // Expect bot to plant on most of the farmland (80%+)
  const expectedMinPlanted = Math.floor(farmlandPositions.length * 0.8);
  const initialSeeds = test.botInventoryCount('wheat_seeds');

  await test.waitUntil(
    () => initialSeeds - test.botInventoryCount('wheat_seeds') >= expectedMinPlanted,
    {
      timeout: 90000,
      message: `Bot should plant at least ${expectedMinPlanted} seeds (on ${farmlandPositions.length} farmland)`,
    }
  );

  const finalSeeds = test.botInventoryCount('wheat_seeds');
  const seedsPlanted = initialSeeds - finalSeeds;
  test.assertGreater(
    seedsPlanted,
    expectedMinPlanted - 1,
    `Bot should have planted most farmland (${seedsPlanted}/${farmlandPositions.length})`
  );

  // Verify wheat blocks actually exist on farmland
  let cropsPlanted = 0;
  for (const pos of farmlandPositions) {
    const block = test.blockAt(pos);
    if (block?.startsWith('wheat')) {
      cropsPlanted++;
    }
  }
  test.assertGreater(
    cropsPlanted,
    expectedMinPlanted - 1,
    `Wheat should be growing on farmland (${cropsPlanted}/${farmlandPositions.length} planted)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Tills ground near water
// ═══════════════════════════════════════════════════════════════════════════

async function testTillsGround() {
  const test = new SimulationTest('Tills ground near water');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source (bot should till around it)
  world.setBlock(new Vec3(10, 63, 10), 'water');

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

  await test.waitUntil(
    () => {
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
// TEST: Gathers seeds from grass
// ═══════════════════════════════════════════════════════════════════════════

async function testGathersSeeds() {
  const test = new SimulationTest('Gathers seeds from grass');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source far from grass
  world.setBlock(new Vec3(-10, 63, -10), 'water');

  // Dense grass patches (need many for reliable seed drops ~12.5% rate)
  for (let x = 2; x <= 10; x++) {
    for (let z = -4; z <= 4; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }
  for (let x = 0; x <= 8; x++) {
    for (let z = 8; z <= 12; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }
  for (let x = 0; x <= 8; x++) {
    for (let z = -12; z <= -8; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  await test.waitForInventory('wheat_seeds', 3, {
    timeout: 120000,
    message: 'Bot should gather at least 3 wheat seeds from grass',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Complete farming cycle (Till -> Plant -> Harvest)
// ═══════════════════════════════════════════════════════════════════════════

async function testCompleteFarmingCycle() {
  const test = new SimulationTest('Complete farming cycle');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(0, 63, 0), 'water');

  // Chest for deposits
  world.setBlock(new Vec3(5, 64, 5), 'chest');

  world.setBlock(new Vec3(-2, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-4, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 0\nY: 63\nZ: 0' });
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 5' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Step 1: Wait for tilling
  await test.waitUntil(
    () => {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (dx === 0 && dz === 0) continue;
          const block = test.blockAt(new Vec3(dx, 63, dz));
          if (block === 'farmland') return true;
        }
      }
      return false;
    },
    { timeout: 60000, message: 'Bot should till ground to create farmland' }
  );

  // Step 2: Wait for planting
  const initialSeeds = test.botInventoryCount('wheat_seeds');
  await test.waitUntil(
    () => test.botInventoryCount('wheat_seeds') < initialSeeds,
    { timeout: 60000, message: 'Bot should plant seeds on farmland' }
  );

  // Step 3: Simulate crop growth via RCON
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      await test.rcon(`setblock ${dx} 64 ${dz} wheat[age=7]`);
    }
  }
  await test.wait(1000, 'Mature wheat placed');

  // Step 4: Wait for harvest
  await test.waitForInventory('wheat', 1, {
    timeout: 60000,
    message: 'Bot should harvest mature wheat',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'harvest': testHarvestsMatureWheat,
  'plant': testPlantsSeeds,
  'till': testTillsGround,
  'seeds': testGathersSeeds,
  'cycle': testCompleteFarmingCycle,
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
