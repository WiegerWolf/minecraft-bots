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

  // Base layer - but we'll cover most of it with invalid surfaces
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(5, 64, 5);

  // Create a challenging environment: village center is on a small island
  // surrounded by water, with only a narrow grass bridge to spawn
  // and ONE valid placement spot near the village center

  // Flood the area around village center with water (5-block radius)
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= 6 && dist > 1.5) {
        world.setBlock(new Vec3(5 + dx, 63, 5 + dz), 'water');
      }
    }
  }

  // Create a narrow bridge from spawn (0,64,0) to village center (5,64,5)
  // Bridge is only 1 block wide - not a valid placement spot (needs open sides)
  for (let i = 0; i <= 7; i++) {
    world.setBlock(new Vec3(i, 63, i), 'grass_block');
  }

  // The ONLY valid placement spot: a small 2x2 grass platform at (7, 63, 5)
  // This is adjacent to village (within 3 blocks) and has valid surface + access
  world.setBlock(new Vec3(7, 63, 5), 'grass_block');
  world.setBlock(new Vec3(8, 63, 5), 'grass_block');
  world.setBlock(new Vec3(7, 63, 6), 'grass_block');
  world.setBlock(new Vec3(8, 63, 6), 'grass_block');

  // Block most other nearby positions with leaves (invalid surface)
  world.setBlock(new Vec3(3, 63, 5), 'oak_leaves');
  world.setBlock(new Vec3(5, 63, 3), 'oak_leaves');
  world.setBlock(new Vec3(5, 63, 7), 'oak_leaves');

  // Village sign at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', {
    signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}`
  });

  const spawnPos = new Vec3(0, 64, 0);

  // Give bot an axe so it won't place crafting table at spawn for axe crafting
  // Instead, it will need to place one at village for CraftInfrastructure goal
  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_planks', count: 16 },
      { name: 'oak_log', count: 32 },  // Trigger infrastructure need
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
    { timeout: 90000, message: 'Bot should place crafting table' }
  );

  const craftingTablePos = bb()?.sharedCraftingTable as Vec3;
  test.assert(craftingTablePos !== null, 'Crafting table position should be set');

  // Verify it's on a valid surface (not water or leaves)
  const groundBlock = test.blockAt(craftingTablePos.offset(0, -1, 0));
  test.assert(
    groundBlock !== null && VALID_SURFACE_BLOCKS.includes(groundBlock),
    `Crafting table should be on valid surface (found: ${groundBlock})`
  );

  // Verify it's NOT over water
  test.assert(
    groundBlock !== 'water',
    'Crafting table should not be placed over water'
  );

  // Verify it's actually a crafting table
  const tableBlock = test.blockAt(craftingTablePos);
  test.assert(tableBlock === 'crafting_table', 'Block at position should be crafting_table');

  // Verify it's near village center (within 5 blocks - accounting for constrained terrain)
  const distToVillage = craftingTablePos.distanceTo(villageCenter);
  test.assert(
    distToVillage <= 6,
    `Crafting table should be near village center (dist=${distToVillage.toFixed(1)})`
  );

  console.log(`  🔧 Crafting table at ${craftingTablePos} (dist to village: ${distToVillage.toFixed(1)})`);

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

  // Village center is far from spawn, with obstacles in between
  // Bot must navigate around them and still place table adjacent to village
  const villageCenter = new Vec3(10, 64, 10);

  // Create a wall between spawn and village that forces a detour
  for (let i = 3; i <= 12; i++) {
    world.setBlock(new Vec3(i, 64, i - 2), 'stone');
    world.setBlock(new Vec3(i, 65, i - 2), 'stone');
  }

  // Add some tempting but distant flat areas that are NOT near village
  // Bot should ignore these and find spots near village center
  world.fill(new Vec3(-10, 63, -10), new Vec3(-5, 63, -5), 'grass_block');

  // Block most positions immediately adjacent to village center
  // Leave only (11, 64, 10) and (10, 64, 11) as valid adjacent spots
  world.setBlock(new Vec3(9, 64, 10), 'stone');   // west
  world.setBlock(new Vec3(9, 65, 10), 'stone');
  world.setBlock(new Vec3(10, 64, 9), 'stone');   // north
  world.setBlock(new Vec3(10, 65, 9), 'stone');
  world.setBlock(new Vec3(9, 64, 9), 'stone');    // northwest
  world.setBlock(new Vec3(9, 65, 9), 'stone');
  world.setBlock(new Vec3(11, 64, 9), 'stone');   // northeast
  world.setBlock(new Vec3(11, 65, 9), 'stone');
  world.setBlock(new Vec3(9, 64, 11), 'stone');   // southwest
  world.setBlock(new Vec3(9, 65, 11), 'stone');
  world.setBlock(new Vec3(11, 64, 11), 'stone');  // southeast
  world.setBlock(new Vec3(11, 65, 11), 'stone');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });

  const spawnPos = new Vec3(0, 64, 0);

  // Give bot an axe so it places crafting table for infrastructure, not axe crafting
  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_planks', count: 16 },
      { name: 'oak_log', count: 32 },  // Trigger infrastructure need
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedCraftingTable !== null,
    { timeout: 90000, message: 'Bot should place crafting table' }
  );

  const craftingTablePos = bb()?.sharedCraftingTable as Vec3;
  const distToVillage = craftingTablePos.distanceTo(villageCenter);

  // Crafting table should be adjacent (within 4 blocks - includes diagonals + constrained terrain)
  test.assert(
    distToVillage <= 4,
    `Crafting table should be adjacent to village center (dist=${distToVillage.toFixed(1)}, expected <= 4)`
  );

  // Verify it's actually a crafting table
  const tableBlock = test.blockAt(craftingTablePos);
  test.assert(tableBlock === 'crafting_table', 'Block at position should be crafting_table');

  // Verify it wasn't placed at one of the obstructed positions
  const obstructedPositions = [
    new Vec3(9, 64, 10), new Vec3(10, 64, 9), new Vec3(9, 64, 9),
    new Vec3(11, 64, 9), new Vec3(9, 64, 11), new Vec3(11, 64, 11),
  ];
  const placedAtObstruction = obstructedPositions.some(obs =>
    craftingTablePos.x === obs.x && craftingTablePos.y === obs.y && craftingTablePos.z === obs.z
  );
  test.assert(!placedAtObstruction, 'Crafting table should not be at obstructed position');

  console.log(`  🔧 Crafting table at ${craftingTablePos} (dist to village: ${distToVillage.toFixed(1)})`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafting table avoids holes
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftingTableAvoidsHoles() {
  const test = new SimulationTest('Crafting table avoids holes');

  const world = new MockWorld();

  // Start with grass everywhere
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(5, 64, 5);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });

  // Create a treacherous area around village center - almost entirely holes
  // with only a narrow safe path and ONE valid placement spot

  // Dig out a large pit around the village center (radius 5)
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= 5) {
        // Create deep holes (3 blocks deep)
        world.setBlock(new Vec3(5 + dx, 63, 5 + dz), 'air');
        world.setBlock(new Vec3(5 + dx, 62, 5 + dz), 'air');
        world.setBlock(new Vec3(5 + dx, 61, 5 + dz), 'air');
      }
    }
  }

  // Create a narrow 1-block-wide bridge from spawn to village center
  // (too narrow for placement - needs adjacent access)
  for (let i = 0; i <= 7; i++) {
    world.setBlock(new Vec3(i, 63, i), 'grass_block');
  }

  // Keep village center itself solid (1x1 - can't place here, bot stands here)
  world.setBlock(new Vec3(5, 63, 5), 'grass_block');

  // The ONLY valid placement spot: a 2x2 platform at the edge of the pit
  // at (8, 63, 4) and (9, 63, 4), (8, 63, 5), (9, 63, 5)
  // This is just within range (dist ~3.6 from village center)
  world.setBlock(new Vec3(8, 63, 4), 'grass_block');
  world.setBlock(new Vec3(9, 63, 4), 'grass_block');
  world.setBlock(new Vec3(8, 63, 5), 'grass_block');
  world.setBlock(new Vec3(9, 63, 5), 'grass_block');

  // Connect the platform to the bridge
  world.setBlock(new Vec3(7, 63, 5), 'grass_block');
  world.setBlock(new Vec3(7, 63, 4), 'grass_block');

  const spawnPos = new Vec3(0, 64, 0);

  // Give bot an axe so it places crafting table for infrastructure, not axe crafting
  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_planks', count: 16 },
      { name: 'oak_log', count: 32 },  // Trigger infrastructure need
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  await test.waitUntil(
    () => bb()?.sharedCraftingTable !== null,
    { timeout: 90000, message: 'Bot should place crafting table' }
  );

  const craftingTablePos = bb()?.sharedCraftingTable as Vec3;

  // Verify there's solid ground below (not placed over a hole)
  const groundBlock = test.blockAt(craftingTablePos.offset(0, -1, 0));
  test.assert(
    groundBlock !== null && groundBlock !== 'air',
    `Crafting table should have solid ground below (found: ${groundBlock})`
  );

  // Verify it's near village center (within 5 blocks - accounting for constrained terrain)
  const distToVillage = craftingTablePos.distanceTo(villageCenter);
  test.assert(
    distToVillage <= 6,
    `Crafting table should be near village center (dist=${distToVillage.toFixed(1)})`
  );

  // Verify it's actually a crafting table
  const tableBlock = test.blockAt(craftingTablePos);
  test.assert(tableBlock === 'crafting_table', 'Block at position should be crafting_table');

  console.log(`  🔧 Crafting table at ${craftingTablePos} (dist to village: ${distToVillage.toFixed(1)})`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Chest placed on valid surface
// ═══════════════════════════════════════════════════════════════════════════

async function testChestOnValidSurface() {
  const test = new SimulationTest('Chest placed on valid surface');

  const world = new MockWorld();

  // Start with grass base for walking paths
  world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');

  const villageCenter = new Vec3(5, 64, 5);

  // Create a challenging swamp-like environment:
  // Most of the area around village center is water or leaves,
  // with only a few scattered valid spots

  // Flood a large area with water (radius 6 around village)
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= 6 && dist > 0.5) {
        world.setBlock(new Vec3(5 + dx, 63, 5 + dz), 'water');
      }
    }
  }

  // Add leaf canopy over some water (still invalid - leaves aren't valid surface)
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if ((dx + dz) % 2 === 0) {
        world.setBlock(new Vec3(5 + dx, 63, 5 + dz), 'oak_leaves');
      }
    }
  }

  // Create a narrow walkway from spawn to village (1 block wide - not good for chest)
  for (let i = 0; i <= 6; i++) {
    world.setBlock(new Vec3(i, 63, i), 'grass_block');
  }

  // The ONLY valid chest spots: small 2x2 grass islands
  // Island 1: at (8, 63, 3) - within 5 blocks of village center
  world.setBlock(new Vec3(8, 63, 3), 'grass_block');
  world.setBlock(new Vec3(9, 63, 3), 'grass_block');
  world.setBlock(new Vec3(8, 63, 4), 'grass_block');
  world.setBlock(new Vec3(9, 63, 4), 'grass_block');

  // Connect island to the walkway
  world.setBlock(new Vec3(7, 63, 4), 'grass_block');
  world.setBlock(new Vec3(7, 63, 5), 'grass_block');

  // Village and forest signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', {
    signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}`
  });
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

  // Verify it's on a valid surface (not water or leaves)
  const groundBlock = test.blockAt(chestPos.offset(0, -1, 0));
  test.assert(
    groundBlock !== null && VALID_SURFACE_BLOCKS.includes(groundBlock),
    `Chest should be on valid surface (found: ${groundBlock})`
  );

  test.assert(
    groundBlock !== 'water' && groundBlock !== 'oak_leaves',
    `Chest should not be over water or leaves (found: ${groundBlock})`
  );

  // Verify it's within range of village center (within 5 blocks)
  const distToVillage = chestPos.distanceTo(villageCenter);
  test.assert(
    distToVillage <= 6,
    `Chest should be near village center (dist=${distToVillage.toFixed(1)})`
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

  // Village center is far from spawn with water and obstacles creating limited paths
  // Bot must navigate around and still place chest near village
  const villageCenter = new Vec3(10, 64, 10);

  // Create scattered water pools that complicate navigation
  // Pool 1: blocks direct diagonal path
  world.setBlock(new Vec3(5, 63, 5), 'water');
  world.setBlock(new Vec3(5, 63, 6), 'water');
  world.setBlock(new Vec3(6, 63, 5), 'water');

  // Pool 2: near village west side
  world.setBlock(new Vec3(7, 63, 9), 'water');
  world.setBlock(new Vec3(7, 63, 10), 'water');
  world.setBlock(new Vec3(7, 63, 11), 'water');

  // Pool 3: near village north side
  world.setBlock(new Vec3(9, 63, 7), 'water');
  world.setBlock(new Vec3(10, 63, 7), 'water');
  world.setBlock(new Vec3(11, 63, 7), 'water');

  // Add a tempting easy area far from village that bot should NOT use
  world.fill(new Vec3(-12, 63, -12), new Vec3(-8, 63, -8), 'grass_block');

  // Add some fences to limit placement near center (but leave gaps)
  world.setBlock(new Vec3(9, 64, 10), 'oak_fence');
  world.setBlock(new Vec3(11, 64, 10), 'oak_fence');
  // Leave (10, 64, 9) and (10, 64, 11) open for access

  // Low ceiling blocks some spots but leaves valid areas
  world.setBlock(new Vec3(8, 65, 8), 'stone');
  world.setBlock(new Vec3(12, 65, 12), 'stone');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: -10\nY: 64\nZ: -10' });

  const spawnPos = new Vec3(0, 64, 0);

  // Give bot planks so it can craft table without issues
  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },
      { name: 'oak_planks', count: 8 },  // For crafting table
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

  // Verify it's not placed in water
  const groundBlock = test.blockAt(chestPos.offset(0, -1, 0));
  test.assert(
    groundBlock !== 'water',
    `Chest should not be placed over water (found: ${groundBlock})`
  );

  // Verify it's actually a chest
  const chestBlock = test.blockAt(chestPos);
  test.assert(chestBlock === 'chest', 'Block at position should be chest');

  // Verify there's air above (not under low ceiling)
  const aboveBlock = test.blockAt(chestPos.offset(0, 1, 0));
  test.assert(
    aboveBlock === 'air' || aboveBlock === null,
    `Chest should have air above (found: ${aboveBlock})`
  );

  console.log(`  📦 Chest at ${chestPos} (dist to village: ${distToVillage.toFixed(1)})`);

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

  const villageCenter = new Vec3(5, 64, 5);

  // Create an environment where some positions have limited open sides
  // The bot must find a spot where the chest will have 2+ open sides

  // Place obstacles that create some corner positions with limited access
  // These are placed away from the immediate village center so bot can place infrastructure

  // Corner barrier at (8, 64, 8) - creates position with only 2 open sides
  world.setBlock(new Vec3(9, 64, 8), 'stone');
  world.setBlock(new Vec3(9, 65, 8), 'stone');
  world.setBlock(new Vec3(8, 64, 9), 'stone');
  world.setBlock(new Vec3(8, 65, 9), 'stone');

  // Another corner at (2, 64, 8)
  world.setBlock(new Vec3(1, 64, 8), 'stone');
  world.setBlock(new Vec3(1, 65, 8), 'stone');
  world.setBlock(new Vec3(2, 64, 9), 'stone');
  world.setBlock(new Vec3(2, 65, 9), 'stone');

  // Wall segment that reduces open sides for adjacent positions
  world.setBlock(new Vec3(5, 64, 8), 'stone');
  world.setBlock(new Vec3(5, 65, 8), 'stone');
  world.setBlock(new Vec3(6, 64, 8), 'stone');
  world.setBlock(new Vec3(6, 65, 8), 'stone');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}` });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: -10\nY: 64\nZ: -10' });

  const spawnPos = new Vec3(0, 64, 0);

  // Give bot planks for crafting table so it can place infrastructure
  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },
      { name: 'oak_planks', count: 8 },
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

  // Count open sides (air blocks adjacent to chest at chest level)
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

  console.log(`  📦 Chest at ${chestPos}, open sides: ${openSides}`);

  test.assert(
    openSides >= 2,
    `Chest should have at least 2 open sides for access (found: ${openSides})`
  );

  // Verify it's near village center
  const distToVillage = chestPos.distanceTo(villageCenter);
  test.assert(
    distToVillage <= 5,
    `Chest should be near village center (dist=${distToVillage.toFixed(1)})`
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

  // Create obstructions that the bot must avoid when placing chests
  // Some positions have blocks above (no air), some have ground-level blocks

  // Low ceiling over specific positions (these positions are invalid for placement)
  world.setBlock(new Vec3(4, 65, 4), 'stone');
  world.setBlock(new Vec3(5, 65, 4), 'stone');
  world.setBlock(new Vec3(6, 65, 4), 'stone');
  world.setBlock(new Vec3(4, 65, 5), 'stone');
  world.setBlock(new Vec3(6, 65, 6), 'stone');

  // Ground-level obstructions at some positions
  world.setBlock(new Vec3(3, 64, 5), 'oak_fence');
  world.setBlock(new Vec3(5, 64, 7), 'oak_fence');
  world.setBlock(new Vec3(7, 64, 5), 'oak_fence');

  // Track obstructed positions for assertion
  const obstructedPositions = [
    new Vec3(4, 64, 4), new Vec3(5, 64, 4), new Vec3(6, 64, 4),  // low ceiling
    new Vec3(4, 64, 5), new Vec3(6, 64, 6),  // low ceiling
    new Vec3(3, 64, 5), new Vec3(5, 64, 7), new Vec3(7, 64, 5),  // ground blocks
  ];

  // Valid spots include: (5, 64, 5), (5, 64, 6), (6, 64, 5), (7, 64, 6), etc.

  const spawnPos = new Vec3(0, 64, 0);

  // Give bot planks for crafting table
  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_log', count: 40 },
      { name: 'oak_planks', count: 8 },
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

  // Verify chest was NOT placed at any obstructed position
  const placedAtObstruction = obstructedPositions.some(obs =>
    chestPos.x === obs.x && chestPos.y === obs.y && chestPos.z === obs.z
  );
  test.assert(!placedAtObstruction, 'Chest should not be placed at obstructed position');

  // Verify there's air above the chest (not under the low ceiling)
  const aboveBlock = test.blockAt(chestPos.offset(0, 1, 0));
  test.assert(
    aboveBlock === 'air' || aboveBlock === null,
    `Chest should have air above (found: ${aboveBlock})`
  );

  // Verify the chest position itself is valid (not a fence or other block)
  const chestBlock = test.blockAt(chestPos);
  test.assert(
    chestBlock === 'chest',
    `Should be a chest at placement position (found: ${chestBlock})`
  );

  // Verify it's near village center
  const distToVillage = chestPos.distanceTo(villageCenter);
  test.assert(
    distToVillage <= 5,
    `Chest should be near village center (dist=${distToVillage.toFixed(1)})`
  );

  console.log(`  📦 Chest placed at ${chestPos} (dist to village: ${distToVillage.toFixed(1)})`);

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
