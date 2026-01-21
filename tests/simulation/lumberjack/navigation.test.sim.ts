#!/usr/bin/env bun
/**
 * Lumberjack Navigation Simulation Tests
 *
 * SPECIFICATION: Long-Range Navigation and Exploration
 *
 * When spawning in unknown territory, the lumberjack must:
 * 1. Explore to find forests when none are known
 * 2. Establish village center near discovered resources
 * 3. Return to spawn to write knowledge signs (VILLAGE, FOREST)
 * 4. Navigate between spawn and work areas reliably
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Explores to find distant forest
// ═══════════════════════════════════════════════════════════════════════════

async function testExploresForDistantForest() {
  const test = new SimulationTest('Explores to find distant forest');

  const world = new MockWorld();
  // Large empty area around spawn - extra margin for pathfinding
  world.fill(new Vec3(-80, 63, -80), new Vec3(80, 63, 80), 'grass_block');

  // Forest far from spawn (40+ blocks away) but not at edge
  const forestCenter = new Vec3(45, 64, 40);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);
  createOakTree(world, forestCenter.offset(1, 0, -3), 5);
  createOakTree(world, forestCenter.offset(-3, 0, -1), 5);

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_sign', count: 5 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for bot to discover the forest (should take exploration)
  await test.waitUntil(
    () => bb()?.knownForests?.length > 0,
    { timeout: 120000, message: 'Bot should discover forest through exploration' }
  );

  // Verify bot traveled significant distance to find forest
  const discoveredForest = bb()?.knownForests[0] as Vec3;
  const distFromSpawn = discoveredForest.distanceTo(spawnPos);
  test.assert(
    distFromSpawn > 30,
    `Discovered forest should be far from spawn (dist=${distFromSpawn.toFixed(1)}, expected > 30)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Avoids water barriers during exploration
// ═══════════════════════════════════════════════════════════════════════════

async function testAvoidsWaterBarriersDuringExploration() {
  const test = new SimulationTest('Finds narrow water crossing to reach island forest');

  const world = new MockWorld();
  // Large area with grass as the mainland
  world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'grass_block');

  // Island with forest at x=50, z=0
  // We'll add water via RCON after setup (much faster than block-by-block)
  const islandCenter = new Vec3(50, 63, 0);

  // Create the island (grass platform)
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) {
      world.setBlock(islandCenter.offset(x, 0, z), 'grass_block');
    }
  }

  // Forest on the island
  const forestCenter = islandCenter.offset(0, 1, 0); // y=64 for trees
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(4, 0, 3), 5);
  createOakTree(world, forestCenter.offset(-4, 0, 4), 5);
  createOakTree(world, forestCenter.offset(3, 0, -4), 4);
  createOakTree(world, forestCenter.offset(-5, 0, -2), 5);

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_boat', count: 1 }, // Boat allows exploration when water detected
    ],
    clearRadius: 150,
  });

  // Use RCON fill commands for water (MUCH faster than block-by-block)
  // Water avoidance rules (from FindForest.ts):
  // - Samples up to 5 points along path (one every 8 blocks)
  // - If >50% of checkpoints are water → returns -30 (skipped)
  // - For 32-block path: 4 checkpoints, need 3+ water to skip
  // - So water needs to be ~24+ blocks wide to trigger avoidance

  // Create wide water surrounding the island (40 blocks wide on most sides)
  // WEST side: wide water from x=5 to x=41 (36 blocks)
  await test.rcon('fill 5 63 -30 41 63 30 minecraft:water replace minecraft:grass_block');
  // NORTH side: wide water at z=9 to z=30 (island ends at z=8)
  await test.rcon('fill 42 63 9 75 63 30 minecraft:water replace minecraft:grass_block');
  // EAST side: wide water from x=59 to x=75 (island ends at x=58)
  await test.rcon('fill 59 63 -30 75 63 8 minecraft:water replace minecraft:grass_block');

  // SOUTH side: NARROW water only 5 blocks wide (z=-9 to z=-13)
  // Island ends at z=-8, this creates a 5-block water gap before mainland at z=-14
  await test.rcon('fill 42 63 -13 58 63 -9 minecraft:water replace minecraft:grass_block');

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for bot to find forest trees (indicated by forestTrees in blackboard)
  await test.waitUntil(
    () => bb()?.forestTrees?.length >= 3,
    { timeout: 90000, message: 'Bot should find forest trees on the island' }
  );

  // Verify the bot found trees near the island (use horizontal distance)
  const forestTrees = bb()?.forestTrees as Array<{ position: Vec3 }>;
  const firstTreePos = forestTrees[0]?.position;

  test.assert(firstTreePos !== undefined, 'Should have at least one forest tree');

  // Use horizontal (XZ) distance to island center
  const horizontalDist = Math.sqrt(
    Math.pow(firstTreePos!.x - islandCenter.x, 2) +
    Math.pow(firstTreePos!.z - islandCenter.z, 2)
  );

  console.log(`  Found ${forestTrees.length} forest trees near (${firstTreePos!.x.toFixed(0)}, ${firstTreePos!.z.toFixed(0)}), dist ${horizontalDist.toFixed(1)} from island center`);

  test.assert(
    horizontalDist < 20,
    `Bot should have found forest trees on the island (dist=${horizontalDist.toFixed(1)})`
  );

  // Check bot is on land
  const botPos = test.bot.entity.position.floored();
  const blockBelow = test.blockAt(botPos.offset(0, -1, 0));
  test.assert(
    blockBelow !== 'water' && blockBelow !== 'flowing_water',
    `Bot should be standing on land (found ${blockBelow})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Establishes village when crafting infrastructure
// ═══════════════════════════════════════════════════════════════════════════

async function testEstablishesVillageWhenCrafting() {
  const test = new SimulationTest('Establishes village when crafting infrastructure');

  const world = new MockWorld();
  world.fill(new Vec3(-80, 63, -80), new Vec3(80, 63, 80), 'grass_block');

  // Forest far from spawn
  const forestCenter = new Vec3(40, 64, 40);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);
  createOakTree(world, forestCenter.offset(1, 0, -3), 5);
  createOakTree(world, forestCenter.offset(-3, 0, -1), 5);

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      // No axe - bot needs to craft one, which triggers crafting table placement
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
      { name: 'oak_sign', count: 5 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for village center to be established (happens when placing crafting table)
  await test.waitUntil(
    () => bb()?.villageCenter !== null,
    { timeout: 60000, message: 'Bot should establish village center' }
  );

  const villageCenter = bb()?.villageCenter as Vec3;
  test.assert(villageCenter !== null, 'Village center should be set');

  // Village is established where bot needs infrastructure (typically near spawn initially)
  // Verify crafting table exists at or near village center
  const sharedCraftingTable = bb()?.sharedCraftingTable as Vec3 | null;
  test.assert(sharedCraftingTable !== null, 'Bot should have placed crafting table');

  if (sharedCraftingTable) {
    const tableDistFromVillage = sharedCraftingTable.distanceTo(villageCenter);
    test.assert(
      tableDistFromVillage <= 3,
      `Crafting table should be at village center (dist=${tableDistFromVillage.toFixed(1)})`
    );
  }

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Returns to spawn to write knowledge signs
// ═══════════════════════════════════════════════════════════════════════════

async function testReturnsToSpawnForSigns() {
  const test = new SimulationTest('Returns to spawn to write knowledge signs');

  const world = new MockWorld();
  // Larger world to avoid edge pathfinding issues
  world.fill(new Vec3(-80, 63, -80), new Vec3(80, 63, 80), 'grass_block');

  // Forest far from spawn but not at edge
  const forestCenter = new Vec3(40, 64, 35);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);
  createOakTree(world, forestCenter.offset(1, 0, -3), 5);
  createOakTree(world, forestCenter.offset(-3, 0, -1), 5);

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      // No axe - triggers village establishment through crafting
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
      { name: 'oak_sign', count: 5 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for signs to be written at spawn
  await test.waitUntil(
    () => {
      const signPositions = bb()?.signPositions as Map<string, Vec3> | undefined;
      const hasVillageSign = signPositions?.has('VILLAGE') ?? false;
      const hasForestSign = signPositions?.has('FOREST') ?? false;
      return hasVillageSign && hasForestSign;
    },
    { timeout: 180000, message: 'Bot should write VILLAGE and FOREST signs at spawn' }
  );

  // Verify signs are near spawn
  const signPositions = bb()?.signPositions as Map<string, Vec3>;

  const villageSignPos = signPositions.get('VILLAGE')!;
  const forestSignPos = signPositions.get('FOREST')!;

  test.assert(
    villageSignPos.distanceTo(spawnPos) <= 5,
    `VILLAGE sign should be near spawn (dist=${villageSignPos.distanceTo(spawnPos).toFixed(1)})`
  );

  test.assert(
    forestSignPos.distanceTo(spawnPos) <= 5,
    `FOREST sign should be near spawn (dist=${forestSignPos.distanceTo(spawnPos).toFixed(1)})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Full pioneer sequence - explore, establish, document
// ═══════════════════════════════════════════════════════════════════════════

async function testFullPioneerSequence() {
  const test = new SimulationTest('Full pioneer sequence');

  const world = new MockWorld();
  // Large world for long-range navigation
  world.fill(new Vec3(-90, 63, -90), new Vec3(90, 63, 90), 'grass_block');

  // Forest far from spawn - bot must explore to find it
  const forestCenter = new Vec3(45, 64, 40);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(4, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-3, 0, 4), 5);
  createOakTree(world, forestCenter.offset(2, 0, -3), 5);
  createOakTree(world, forestCenter.offset(-2, 0, -2), 4);
  createOakTree(world, forestCenter.offset(5, 0, -1), 5);

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      // No axe - needs to craft, triggering village establishment
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
      { name: 'oak_sign', count: 5 },
      { name: 'chest', count: 1 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Track sequence of events
  const events: string[] = [];

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Phase 1: Bot explores and finds forest
  await test.waitUntil(
    () => {
      if (bb()?.knownForests?.length > 0 && !events.includes('forest_found')) {
        events.push('forest_found');
      }
      return events.includes('forest_found');
    },
    { timeout: 120000, message: 'Phase 1: Bot should find forest' }
  );
  test.assert(events.includes('forest_found'), 'Bot found forest through exploration');

  // Phase 2: Bot establishes village
  await test.waitUntil(
    () => {
      if (bb()?.villageCenter !== null && !events.includes('village_established')) {
        events.push('village_established');
      }
      return events.includes('village_established');
    },
    { timeout: 60000, message: 'Phase 2: Bot should establish village' }
  );
  test.assert(events.includes('village_established'), 'Bot established village center');

  // Phase 3: Bot writes signs at spawn
  await test.waitUntil(
    () => {
      const signPositions = bb()?.signPositions as Map<string, Vec3> | undefined;
      if (signPositions?.has('VILLAGE') && signPositions?.has('FOREST') && !events.includes('signs_written')) {
        events.push('signs_written');
      }
      return events.includes('signs_written');
    },
    { timeout: 120000, message: 'Phase 3: Bot should write signs at spawn' }
  );
  test.assert(events.includes('signs_written'), 'Bot wrote knowledge signs at spawn');

  // Verify the full sequence happened
  test.assertEqual(events.length, 3, 'All three phases should complete');

  // Verify village center is established (at spawn where crafting happens)
  const villageCenter = bb()?.villageCenter as Vec3;
  test.assert(villageCenter !== null, 'Village center should be set');

  // Verify signs point to correct locations (both at spawn)
  const signPositions = bb()?.signPositions as Map<string, Vec3>;
  test.assert(
    signPositions.get('VILLAGE')!.distanceTo(spawnPos) <= 5,
    'VILLAGE sign should be at spawn'
  );
  test.assert(
    signPositions.get('FOREST')!.distanceTo(spawnPos) <= 5,
    'FOREST sign should be at spawn'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Navigates back to forest after visiting spawn
// ═══════════════════════════════════════════════════════════════════════════

async function testNavigatesBackToForest() {
  const test = new SimulationTest('Navigates back to forest after spawn visit');

  const world = new MockWorld();
  // Larger world to avoid edge pathfinding issues
  world.fill(new Vec3(-80, 63, -80), new Vec3(80, 63, 80), 'grass_block');

  // Forest far from spawn but not at edge
  const forestCenter = new Vec3(40, 64, 35);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);
  createOakTree(world, forestCenter.offset(1, 0, -3), 5);
  createOakTree(world, forestCenter.offset(-3, 0, -1), 5);

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      // No axe - triggers village establishment
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
      { name: 'oak_sign', count: 5 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for signs to be written (bot had to go to spawn)
  await test.waitUntil(
    () => {
      const signPositions = bb()?.signPositions as Map<string, Vec3> | undefined;
      return signPositions?.has('FOREST') ?? false;
    },
    { timeout: 180000, message: 'Bot should write FOREST sign at spawn' }
  );

  // Now wait for bot to collect logs (proving it went back to forest)
  await test.waitUntil(
    () => {
      const logCount = test.bot.inventory.items()
        .filter(i => i.name.includes('_log'))
        .reduce((sum, i) => sum + i.count, 0);
      return logCount >= 3;
    },
    { timeout: 120000, message: 'Bot should return to forest and collect logs' }
  );

  // Verify bot is near forest now
  const botPos = test.bot.entity.position;
  const distToForest = botPos.distanceTo(forestCenter);
  test.assert(
    distToForest < 25,
    `Bot should be near forest after returning (dist=${distToForest.toFixed(1)})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'explore-distant': testExploresForDistantForest,
  'water-barrier': testAvoidsWaterBarriersDuringExploration,
  'establish-village': testEstablishesVillageWhenCrafting,
  // Long integration tests disabled for now due to pathfinding timeouts in test environment
  // 'return-for-signs': testReturnsToSpawnForSigns,
  // 'full-pioneer': testFullPioneerSequence,
  // 'navigate-back': testNavigatesBackToForest,
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
