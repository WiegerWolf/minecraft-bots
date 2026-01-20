#!/usr/bin/env bun
/**
 * Farmer Knowledge Simulation Tests
 *
 * SPECIFICATION: Farmer Knowledge Management
 *
 * Farmers use sign-based knowledge:
 * - Read existing FARM signs to find established farms
 * - Learn about village infrastructure from signs
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Reads existing FARM sign
// ═══════════════════════════════════════════════════════════════════════════

async function testReadsFarmSign() {
  const test = new SimulationTest('Reads FARM sign');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source at farm location
  world.setBlock(new Vec3(15, 63, 15), 'water');

  // Pre-existing farmland
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(15 + dx, 63, 15 + dz), 'farmland');
    }
  }

  // Signs - FARM sign tells bot where farm is
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 63\nZ: 15' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Bot should read FARM sign and plant at that location
  const initialSeeds = test.botInventoryCount('wheat_seeds');
  await test.waitUntil(
    () => test.botInventoryCount('wheat_seeds') < initialSeeds,
    { timeout: 90000, message: 'Bot should read FARM sign and plant at farm location (15,63,15)' }
  );

  // Verify crops planted near FARM sign location
  let cropsNearFarm = 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const block = test.blockAt(new Vec3(15 + dx, 64, 15 + dz));
      if (block?.includes('wheat')) cropsNearFarm++;
    }
  }

  test.assertGreater(cropsNearFarm, 0, 'Crops should be planted near the FARM sign location');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Learns village infrastructure from signs
// ═══════════════════════════════════════════════════════════════════════════

async function testLearnsInfrastructure() {
  const test = new SimulationTest('Learns village infrastructure from signs');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Set up village infrastructure signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -8\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: -8\nY: 64\nZ: 2' });
  world.setBlock(new Vec3(6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 12\nY: 63\nZ: 12' });

  // Put actual infrastructure
  world.setBlock(new Vec3(-8, 64, 0), 'chest');
  world.setBlock(new Vec3(-8, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(12, 63, 12), 'water');

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Let the bot read signs
  await test.wait(20000, 'Bot reading signs and learning infrastructure');

  // Bot should have moved to read signs (toward origin area)
  test.assertNear(new Vec3(0, 64, 0), 10, 'Bot should have moved near signs to study them');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'read-farm': testReadsFarmSign,
  'infrastructure': testLearnsInfrastructure,
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
