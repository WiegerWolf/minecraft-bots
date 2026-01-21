#!/usr/bin/env bun
/**
 * Lumberjack Placement Simulation Tests
 *
 * SPECIFICATION: Infrastructure Placement Rules
 *
 * When placing chests and crafting tables, the bot must:
 * 1. Place near village center (chest: within 5 blocks, crafting table: adjacent)
 * 2. Place on valid surfaces (grass, dirt, stone - not air, water, leaves)
 * 3. Ensure accessibility (air above, at least 2 open sides)
 * 4. Avoid holes and underground locations
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

// Valid surface blocks that infrastructure can be placed on
const VALID_SURFACE_BLOCKS = [
  'grass_block', 'dirt', 'podzol', 'stone', 'deepslate',
  'andesite', 'diorite', 'granite', 'sand', 'gravel',
];

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafting table placed on valid surface
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftingTableOnValidSurface() {
  const test = new SimulationTest('Crafting table placed on valid surface');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  // Village sign
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 5' });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for crafting table to be placed
  await test.waitUntil(
    () => bb()?.sharedCraftingTable !== null,
    { timeout: 60000, message: 'Bot should place crafting table' }
  );

  const craftingTablePos = bb()?.sharedCraftingTable as Vec3;
  test.assert(craftingTablePos !== null, 'Crafting table position should be set');

  // Verify it's on a valid surface
  const groundBlock = test.blockAt(craftingTablePos.offset(0, -1, 0));
  test.assert(
    groundBlock !== null && VALID_SURFACE_BLOCKS.includes(groundBlock),
    `Crafting table should be on valid surface (found: ${groundBlock})`
  );

  // Verify it's actually a crafting table
  const tableBlock = test.blockAt(craftingTablePos);
  test.assert(tableBlock === 'crafting_table', 'Block at position should be crafting_table');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafting table placed adjacent to village center
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftingTableNearVillageCenter() {
  const test = new SimulationTest('Crafting table adjacent to village center');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(8, 64, 8);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedCraftingTable !== null,
    { timeout: 60000, message: 'Bot should place crafting table' }
  );

  const craftingTablePos = bb()?.sharedCraftingTable as Vec3;
  const distToVillage = craftingTablePos.distanceTo(villageCenter);

  // Crafting table should be adjacent (within 3 blocks - includes diagonals)
  test.assert(
    distToVillage <= 3,
    `Crafting table should be adjacent to village center (dist=${distToVillage.toFixed(1)}, expected <= 3)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafting table avoids holes
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftingTableAvoidsHoles() {
  const test = new SimulationTest('Crafting table avoids holes');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(5, 64, 5);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });

  // Create holes around village center (remove ground blocks)
  // Leave only one valid spot at (6, 64, 5)
  const holePositions = [
    new Vec3(4, 63, 5),  // -1, 0
    new Vec3(5, 63, 4),  // 0, -1
    new Vec3(5, 63, 6),  // 0, +1
    new Vec3(4, 63, 4),  // -1, -1
    new Vec3(4, 63, 6),  // -1, +1
    new Vec3(6, 63, 4),  // +1, -1
    new Vec3(6, 63, 6),  // +1, +1
  ];
  for (const pos of holePositions) {
    world.setBlock(pos, 'air');
    world.setBlock(pos.offset(0, -1, 0), 'air');
    world.setBlock(pos.offset(0, -2, 0), 'air');
  }

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedCraftingTable !== null,
    { timeout: 60000, message: 'Bot should place crafting table' }
  );

  const craftingTablePos = bb()?.sharedCraftingTable as Vec3;

  // Verify it was NOT placed in any of the holes
  const placedInHole = holePositions.some(hole =>
    craftingTablePos.x === hole.x && craftingTablePos.z === hole.z
  );
  test.assert(!placedInHole, 'Crafting table should not be placed in a hole');

  // Verify there's solid ground below
  const groundBlock = test.blockAt(craftingTablePos.offset(0, -1, 0));
  test.assert(
    groundBlock !== null && groundBlock !== 'air',
    `Crafting table should have solid ground below (found: ${groundBlock})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Chest placed on valid surface
// ═══════════════════════════════════════════════════════════════════════════

async function testChestOnValidSurface() {
  const test = new SimulationTest('Chest placed on valid surface');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  // Village and forest signs (forest sign prevents bot from wasting time exploring)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 5' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: -10\nY: 64\nZ: -10' });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },  // Trigger deposit need
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedChest !== null,
    { timeout: 90000, message: 'Bot should place chest' }
  );

  const chestPos = bb()?.sharedChest as Vec3;
  test.assert(chestPos !== null, 'Chest position should be set');

  // Verify it's on a valid surface
  const groundBlock = test.blockAt(chestPos.offset(0, -1, 0));
  test.assert(
    groundBlock !== null && VALID_SURFACE_BLOCKS.includes(groundBlock),
    `Chest should be on valid surface (found: ${groundBlock})`
  );

  // Verify it's actually a chest
  const chestBlock = test.blockAt(chestPos);
  test.assert(chestBlock === 'chest', 'Block at position should be chest');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Chest placed near village center
// ═══════════════════════════════════════════════════════════════════════════

async function testChestNearVillageCenter() {
  const test = new SimulationTest('Chest placed near village center');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(8, 64, 8);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: -10\nY: 64\nZ: -10' });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedChest !== null,
    { timeout: 90000, message: 'Bot should place chest' }
  );

  const chestPos = bb()?.sharedChest as Vec3;
  const distToVillage = chestPos.distanceTo(villageCenter);

  // Chest should be within 5 blocks of village center
  test.assert(
    distToVillage <= 5,
    `Chest should be within 5 blocks of village center (dist=${distToVillage.toFixed(1)})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Chest has accessible sides
// ═══════════════════════════════════════════════════════════════════════════

async function testChestHasAccessibleSides() {
  const test = new SimulationTest('Chest has accessible sides');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 5' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: -10\nY: 64\nZ: -10' });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedChest !== null,
    { timeout: 90000, message: 'Bot should place chest' }
  );

  const chestPos = bb()?.sharedChest as Vec3;

  // Count open sides (air blocks adjacent to chest)
  const cardinalOffsets = [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1), new Vec3(0, 0, -1),
  ];

  let openSides = 0;
  for (const offset of cardinalOffsets) {
    const adjacentBlock = test.blockAt(chestPos.plus(offset));
    if (adjacentBlock === 'air' || adjacentBlock === null) {
      openSides++;
    }
  }

  test.assert(
    openSides >= 2,
    `Chest should have at least 2 open sides for access (found: ${openSides})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Chest avoids obstructed positions
// ═══════════════════════════════════════════════════════════════════════════

async function testChestAvoidsObstructions() {
  const test = new SimulationTest('Chest avoids obstructed positions');

  const world = new MockWorld();
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(5, 64, 5);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: -10\nY: 64\nZ: -10' });

  // Place walls around most preferred chest positions
  // Chest prefers corners (±3, ±3), so block some of those
  world.setBlock(new Vec3(8, 64, 8), 'stone');  // Block (3,3) corner
  world.setBlock(new Vec3(8, 65, 8), 'stone');
  world.setBlock(new Vec3(2, 64, 8), 'stone');  // Block (-3,3) corner
  world.setBlock(new Vec3(2, 65, 8), 'stone');
  world.setBlock(new Vec3(8, 64, 2), 'stone');  // Block (3,-3) corner
  world.setBlock(new Vec3(8, 65, 2), 'stone');

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedChest !== null,
    { timeout: 90000, message: 'Bot should place chest' }
  );

  const chestPos = bb()?.sharedChest as Vec3;

  // Verify chest was NOT placed at obstructed positions
  const obstructedPositions = [
    new Vec3(8, 64, 8),
    new Vec3(2, 64, 8),
    new Vec3(8, 64, 2),
  ];

  const placedAtObstruction = obstructedPositions.some(obs =>
    chestPos.x === obs.x && chestPos.y === obs.y && chestPos.z === obs.z
  );
  test.assert(!placedAtObstruction, 'Chest should not be placed at obstructed position');

  // Verify there's air above the chest
  const aboveBlock = test.blockAt(chestPos.offset(0, 1, 0));
  test.assert(
    aboveBlock === 'air' || aboveBlock === null,
    `Chest should have air above (found: ${aboveBlock})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'craft-table-surface': testCraftingTableOnValidSurface,
  'craft-table-adjacent': testCraftingTableNearVillageCenter,
  'craft-table-avoids-holes': testCraftingTableAvoidsHoles,
  'chest-surface': testChestOnValidSurface,
  'chest-near-village': testChestNearVillageCenter,
  'chest-accessible': testChestHasAccessibleSides,
  'chest-avoids-obstructions': testChestAvoidsObstructions,
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
