#!/usr/bin/env bun
/**
 * Farmer Startup Simulation Tests
 *
 * SPECIFICATION: Farmer Startup Behavior
 *
 * When a farmer spawns, it must:
 * 1. Study signs to learn about existing infrastructure
 * 2. Establish a farm near water (if none exists)
 * 3. Gather seeds or get tools to begin farming
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Fresh spawn studies signs first
// ═══════════════════════════════════════════════════════════════════════════

async function testStudiesSignsFirst() {
  const test = new SimulationTest('Fresh spawn studies signs first');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village infrastructure signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 63\nZ: 15' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  // Actual infrastructure
  world.setBlock(new Vec3(15, 63, 15), 'water');
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Bot should move toward signs to study them
  await test.waitForPosition(new Vec3(0, 64, 0), 5, {
    timeout: 30000,
    message: 'Bot should move near village sign to study it',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Establishes farm near water when no FARM sign exists
// ═══════════════════════════════════════════════════════════════════════════

async function testEstablishesFarmNearWater() {
  const test = new SimulationTest('Establishes farm near water');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source - bot should establish farm here
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Only village sign - no FARM sign (bot must find water)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Clear sky above water for proper detection
  await test.rcon('fill 6 64 6 14 80 14 air replace');
  await test.wait(500, 'Clear sky');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to establish farm (creates farmland near water)
  await test.waitUntil(
    () => {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const block = test.blockAt(new Vec3(10 + dx, 63, 10 + dz));
          if (block === 'farmland') return true;
        }
      }
      return false;
    },
    { timeout: 90000, message: 'Bot should establish farm near water (create farmland)' }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Full startup sequence with village center
// ═══════════════════════════════════════════════════════════════════════════

async function testFullStartupSequence() {
  const test = new SimulationTest('Full startup sequence');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm establishment
  world.setBlock(new Vec3(8, 63, 8), 'water');

  // Village sign at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Grass for seed gathering
  for (let x = -10; x <= -6; x++) {
    for (let z = -3; z <= 3; z++) {
      if ((x + z) % 2 === 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Clear sky above water
  await test.rcon('fill 4 64 4 12 80 12 air replace');
  await test.wait(500, 'Clear sky');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for full startup: sign study -> farm establish -> plant
  await test.wait(60000, 'Full startup sequence');

  // Verify bot completed startup
  const cropResult = await test.rcon('fill 3 64 3 13 64 13 air replace wheat');
  const cropMatch = cropResult.match(/Successfully filled (\d+) block/);
  const cropsFound = cropMatch ? parseInt(cropMatch[1]) : 0;

  const farmResult = await test.rcon('fill 3 63 3 13 63 13 dirt replace farmland');
  const farmMatch = farmResult.match(/Successfully filled (\d+) block/);
  const farmlandFound = farmMatch ? parseInt(farmMatch[1]) : 0;

  test.assertGreater(cropsFound, 0, `Bot should have planted crops (found ${cropsFound})`);
  test.assertGreater(farmlandFound, 0, `Bot should have tilled farmland (found ${farmlandFound})`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'signs': testStudiesSignsFirst,
  'establish': testEstablishesFarmNearWater,
  'full-startup': testFullStartupSequence,
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
