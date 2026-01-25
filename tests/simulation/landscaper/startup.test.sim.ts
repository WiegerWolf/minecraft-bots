#!/usr/bin/env bun
/**
 * Landscaper Startup Simulation Tests
 *
 * SPECIFICATION: Landscaper Startup Behavior
 *
 * When a landscaper spawns, it must:
 * 1. Study signs to learn about existing farms
 * 2. Check known farms for maintenance
 * 3. Wait for requests (NOT explore)
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Fresh spawn studies signs first
// ═══════════════════════════════════════════════════════════════════════════

async function testStudiesSignsFirst() {
  const test = new SimulationTest('Fresh spawn studies signs first');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village infrastructure signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: -5\nY: 64\nZ: 2' });
  world.setBlock(new Vec3(6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 63\nZ: 15' });

  // Actual infrastructure
  world.setBlock(new Vec3(-5, 64, 0), 'chest');
  world.setBlock(new Vec3(-5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(15, 63, 15), 'water');

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_shovel', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Let the bot read signs
  await test.wait(15000, 'Bot studying signs');

  // Bot should have moved near signs to study them
  test.assertNear(new Vec3(0, 64, 0), 10, 'Bot should have moved near signs to study them');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Obtains tools when materials available
// ═══════════════════════════════════════════════════════════════════════════

async function testObtainsToolsWithMaterials() {
  const test = new SimulationTest('Obtains tools with materials');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Crafting table
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // No tools, but materials
      { name: 'oak_planks', count: 8 },
      { name: 'stick', count: 4 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_shovel'));
    },
    {
      timeout: 90000,
      message: 'Bot should craft a shovel',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Waits at spawn when no work available
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Landscaper Idle Behavior
//
// Unlike lumberjacks who explore for forests, landscapers should mostly
// wait at spawn for terraform requests. The ExploreGoal returns very low
// utility (5-15) as a fallback - landscaper shouldn't wander off.

async function testWaitsAtSpawnWhenIdle() {
  const test = new SimulationTest('Waits at spawn when no work');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village signs but NO farms, NO terraform requests, NO issues
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 16 },
    ],
    clearRadius: 40,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const spawnArea = new Vec3(0, 64, 0);
  const initialDistFromSpawn = test.botDistanceTo(spawnArea);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Let bot run for 30 seconds - it should stay near spawn
  await test.wait(30000, 'Bot idling at spawn');

  const finalDistFromSpawn = test.botDistanceTo(spawnArea);

  console.log(`  📍 Distance from spawn: initial=${initialDistFromSpawn.toFixed(1)}, final=${finalDistFromSpawn.toFixed(1)}`);

  // Bot should NOT have wandered far from spawn
  // Unlike lumberjack's explore, landscaper should stay put
  test.assert(
    finalDistFromSpawn < 25,
    `Bot should stay near spawn when idle (distance: ${finalDistFromSpawn.toFixed(1)}, expected <25)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Proactively checks known farms after studying signs
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Proactive Farm Checking
//
// After reading signs, if a FARM sign is found, the landscaper should
// visit that farm to check for terraform needs (CheckKnownFarmsGoal).

async function testChecksKnownFarmsAfterStudy() {
  const test = new SimulationTest('Checks known farms after studying signs');

  const world = new MockWorld();
  world.fill(new Vec3(-40, 63, -40), new Vec3(40, 63, 40), 'grass_block');

  // Farm at a distance from spawn
  const farmCenter = new Vec3(25, 63, 25);
  world.fill(new Vec3(21, 62, 21), new Vec3(29, 62, 29), 'stone');
  world.fill(new Vec3(21, 63, 21), new Vec3(29, 63, 29), 'grass_block');
  world.setBlock(farmCenter, 'water');

  // Signs at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 25\nY: 63\nZ: 25' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 16 },
    ],
    clearRadius: 50,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Track phases
  let studiedSigns = false;
  let visitedFarm = false;
  let initialFarmsToCheck = -1;

  await test.waitUntil(
    () => {
      const bb = (role as any).blackboard;
      if (!bb) return false;

      if (!studiedSigns && bb.hasStudiedSigns) {
        studiedSigns = true;
        initialFarmsToCheck = bb.farmsNeedingCheck?.length ?? 0;
        console.log('  ✓ Phase 1: Studied signs');
        console.log(`     Known farms: ${bb.knownFarms?.length ?? 0}`);
        console.log(`     Farms to check: ${initialFarmsToCheck}`);
      }

      // Check if farm was checked (farmsNeedingCheck decreased) OR bot is near farm
      if (studiedSigns && !visitedFarm) {
        const currentFarmsToCheck = bb.farmsNeedingCheck?.length ?? 0;
        const distToFarm = test.botDistanceTo(farmCenter);

        // Farm was checked if: farmsNeedingCheck went down OR bot is near farm
        if (currentFarmsToCheck < initialFarmsToCheck) {
          visitedFarm = true;
          console.log(`  ✓ Phase 2: Farm checked (farmsNeedingCheck: ${initialFarmsToCheck} -> ${currentFarmsToCheck})`);
        } else if (distToFarm < 15) {
          visitedFarm = true;
          console.log(`  ✓ Phase 2: Visited farm (distance: ${distToFarm.toFixed(1)})`);
        }
      }

      return visitedFarm;
    },
    {
      timeout: 90000,
      interval: 500, // Check more frequently
      message: 'Bot should study signs and visit known farm to check it',
    }
  );

  test.assert(studiedSigns, 'Bot should have studied signs');
  test.assert(visitedFarm, 'Bot should have visited the known farm');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Learns farm locations from signs
// ═══════════════════════════════════════════════════════════════════════════

async function testLearnsFarmLocationsFromSigns() {
  const test = new SimulationTest('Learns farm locations from signs');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Multiple farm signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 30\nY: 63\nZ: 30' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[FARM]\nX: -30\nY: 63\nZ: 30' });
  world.setBlock(new Vec3(6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 30\nY: 63\nZ: -30' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for bot to study signs
  await test.waitUntil(
    () => {
      const bb = (role as any).blackboard;
      return bb?.hasStudiedSigns === true;
    },
    {
      timeout: 30000,
      message: 'Bot should study spawn signs',
    }
  );

  const bb = (role as any).blackboard;
  const knownFarms = bb.knownFarms ?? [];

  console.log(`  📋 Known farms after studying signs: ${knownFarms.length}`);
  for (const farm of knownFarms) {
    console.log(`     - (${farm.x}, ${farm.y}, ${farm.z})`);
  }

  test.assert(
    knownFarms.length >= 3,
    `Bot should have learned about 3 farms from signs (found ${knownFarms.length})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'signs': testStudiesSignsFirst,
  'tools': testObtainsToolsWithMaterials,
  'idle': testWaitsAtSpawnWhenIdle,
  'check-farms': testChecksKnownFarmsAfterStudy,
  'learn-farms': testLearnsFarmLocationsFromSigns,
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
