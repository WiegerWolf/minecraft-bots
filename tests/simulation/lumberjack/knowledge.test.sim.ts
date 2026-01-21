#!/usr/bin/env bun
/**
 * Lumberjack Knowledge Simulation Tests
 *
 * SPECIFICATION: Lumberjack Knowledge Management
 *
 * Lumberjacks use sign-based knowledge:
 * - Read existing FOREST signs to find tree areas
 * - Write FOREST signs when discovering new forests
 * - Learn and share infrastructure (CHEST, CRAFT) locations
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Reads existing FOREST sign
// ═══════════════════════════════════════════════════════════════════════════

async function testReadsForestSign() {
  const test = new SimulationTest('Reads FOREST sign');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Create a forest at the sign location
  const forestCenter = new Vec3(15, 64, 15);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(4, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-3, 0, 4), 5);

  // Signs - FOREST sign tells bot where trees are
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 15' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Collect chat messages from the bot
  const chatMessages: string[] = [];
  test.bot.on('chat', (username: string, message: string) => {
    if (username === test.bot.username) {
      chatMessages.push(message);
    }
  });

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to study signs
  const bb = () => (role as any).blackboard;
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Verify chat announcement mentions studying signs and the forest
  const hasStudiedAnnouncement = chatMessages.some(msg =>
    msg.toLowerCase().includes('studied') && msg.toLowerCase().includes('forest')
  );
  test.assert(hasStudiedAnnouncement, 'Bot should announce studying forest sign in chat');

  // Verify blackboard has learned forest location
  const knownForests = bb()?.knownForests || [];
  const hasForestKnowledge = knownForests.some((pos: Vec3) =>
    pos.x === 15 && pos.y === 64 && pos.z === 15
  );
  test.assert(hasForestKnowledge, 'Bot blackboard should have forest at (15, 64, 15) in knownForests');

  // Verify hasKnownForest flag is set
  test.assert(bb()?.hasKnownForest === true, 'Bot should have hasKnownForest flag set');

  // Verify sign was marked as read
  const readSignPositions = bb()?.readSignPositions as Set<string> | undefined;
  const forestSignRead = readSignPositions?.has('2,64,0');
  test.assert(forestSignRead === true, 'Bot should mark FOREST sign position as read');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Places FOREST sign after discovering forest
// ═══════════════════════════════════════════════════════════════════════════

async function testPlacesForestSign() {
  const test = new SimulationTest('Places FOREST sign after discovering forest');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Create a forest cluster (5+ trees needed to trigger sign write)
  const forestCenter = new Vec3(15, 64, 15);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(4, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-3, 0, 4), 5);
  createOakTree(world, forestCenter.offset(2, 0, -3), 5);
  createOakTree(world, forestCenter.offset(-2, 0, -2), 4);

  // Only VILLAGE sign - no FOREST sign (bot should create one)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_sign', count: 3 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Collect chat messages from the bot
  const chatMessages: string[] = [];
  test.bot.on('chat', (username: string, message: string) => {
    if (username === test.bot.username) {
      chatMessages.push(message);
    }
  });

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for bot to study signs first
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Wait for FOREST sign to be placed
  await test.waitUntil(
    () => {
      const signPos = bb()?.signPositions?.get('FOREST');
      const hasAnnouncement = chatMessages.some(msg =>
        msg.toLowerCase().includes('forest') && msg.toLowerCase().includes('sign')
      );
      return signPos !== undefined || hasAnnouncement;
    },
    { timeout: 90000, message: 'Bot should place FOREST sign after discovering forest' }
  );

  // Verify sign was placed
  const signPositions = bb()?.signPositions as Map<string, Vec3> | undefined;
  const forestSignPos = signPositions?.get('FOREST');
  test.assert(forestSignPos !== undefined, 'Blackboard signPositions should have FOREST entry');

  // Verify a sign actually exists at the recorded position
  if (forestSignPos) {
    const signBlock = test.blockAt(forestSignPos);
    test.assert(
      signBlock?.includes('sign') === true,
      `Sign block should exist at recorded position (${forestSignPos.x}, ${forestSignPos.y}, ${forestSignPos.z})`
    );
  }

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
  world.setBlock(new Vec3(6, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 12\nY: 64\nZ: 12' });

  // Put actual infrastructure
  world.setBlock(new Vec3(-8, 64, 0), 'chest');
  world.setBlock(new Vec3(-8, 64, 2), 'crafting_table');

  // Create a small forest at the sign location
  createOakTree(world, new Vec3(12, 64, 12), 5);
  createOakTree(world, new Vec3(16, 64, 14), 5);
  createOakTree(world, new Vec3(10, 64, 16), 5);

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Collect chat messages from the bot
  const chatMessages: string[] = [];
  test.bot.on('chat', (username: string, message: string) => {
    if (username === test.bot.username) {
      chatMessages.push(message);
    }
  });

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to study signs
  const bb = () => (role as any).blackboard;
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Verify chat announcement mentions studying signs
  const hasStudiedAnnouncement = chatMessages.some(msg =>
    msg.toLowerCase().includes('studied')
  );
  test.assert(hasStudiedAnnouncement, 'Bot should announce studying signs in chat');

  // Verify blackboard learned village center
  const villageCenter = bb()?.villageCenter;
  const hasVillageCenter = villageCenter?.x === 0 && villageCenter?.y === 64 && villageCenter?.z === 0;
  test.assert(hasVillageCenter, 'Bot should learn village center at (0, 64, 0)');

  // Verify blackboard learned shared chest location
  const sharedChest = bb()?.sharedChest;
  const hasChestKnowledge = sharedChest?.x === -8 && sharedChest?.y === 64 && sharedChest?.z === 0;
  test.assert(hasChestKnowledge, 'Bot should learn shared chest at (-8, 64, 0)');

  // Verify blackboard learned shared crafting table location
  const sharedCraftingTable = bb()?.sharedCraftingTable;
  const hasCraftingKnowledge = sharedCraftingTable?.x === -8 && sharedCraftingTable?.y === 64 && sharedCraftingTable?.z === 2;
  test.assert(hasCraftingKnowledge, 'Bot should learn crafting table at (-8, 64, 2)');

  // Verify blackboard learned forest location
  const knownForests = bb()?.knownForests || [];
  const hasForestKnowledge = knownForests.some((pos: Vec3) =>
    pos.x === 12 && pos.y === 64 && pos.z === 12
  );
  test.assert(hasForestKnowledge, 'Bot should learn forest at (12, 64, 12)');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Places CHEST sign after placing storage chest
// ═══════════════════════════════════════════════════════════════════════════

async function testPlacesChestSign() {
  const test = new SimulationTest('Places CHEST sign after placing storage chest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Forest for lumberjack to work in
  const forestCenter = new Vec3(15, 64, 15);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(4, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-3, 0, 4), 5);

  // Only VILLAGE and FOREST signs - no CHEST sign
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 15' });

  const spawnPos = new Vec3(0, 64, 0);

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'chest', count: 1 },
      { name: 'oak_sign', count: 3 },
      { name: 'oak_log', count: 40 },  // Enough logs to trigger deposit need
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Collect chat messages from the bot
  const chatMessages: string[] = [];
  test.bot.on('chat', (username: string, message: string) => {
    if (username === test.bot.username) {
      chatMessages.push(message);
    }
  });

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for bot to study signs
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Wait for CHEST sign to be placed (bot should place chest and then sign)
  await test.waitUntil(
    () => {
      const signPos = bb()?.signPositions?.get('CHEST');
      return signPos !== undefined;
    },
    { timeout: 120000, message: 'Bot should place CHEST sign after placing storage chest' }
  );

  // Verify sign was placed
  const signPositions = bb()?.signPositions as Map<string, Vec3> | undefined;
  const chestSignPos = signPositions?.get('CHEST');
  test.assert(chestSignPos !== undefined, 'Blackboard signPositions should have CHEST entry');

  // Verify sharedChest is set
  const sharedChest = bb()?.sharedChest;
  test.assert(sharedChest !== undefined, 'Bot should have sharedChest location set');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Places CRAFT sign after placing crafting table
// ═══════════════════════════════════════════════════════════════════════════

async function testPlacesCraftSign() {
  const test = new SimulationTest('Places CRAFT sign after placing crafting table');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(30, 63, 30), 'grass_block');

  // Forest for lumberjack to work in
  const forestCenter = new Vec3(20, 64, 20);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(4, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-3, 0, 4), 5);

  // Spawn at origin, but village center is 15 blocks away
  // This verifies: crafting table placed near village, sign placed near spawn
  const spawnPos = new Vec3(0, 64, 0);
  const villageCenter = new Vec3(15, 64, 15);

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 15\nY: 64\nZ: 15' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 20\nY: 64\nZ: 20' });

  await test.setup(world, {
    botPosition: spawnPos.clone(),
    botInventory: [
      // No axe - bot needs to craft one, which requires crafting table
      { name: 'oak_planks', count: 16 },
      { name: 'stick', count: 8 },
      { name: 'oak_sign', count: 3 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

  const bb = () => (role as any).blackboard;

  // Wait for bot to study signs
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Wait for CRAFT sign to be placed (bot needs crafting table for axe)
  await test.waitUntil(
    () => {
      const signPos = bb()?.signPositions?.get('CRAFT');
      return signPos !== undefined;
    },
    { timeout: 120000, message: 'Bot should place CRAFT sign after placing crafting table' }
  );

  // Verify sign was placed
  const signPositions = bb()?.signPositions as Map<string, Vec3> | undefined;
  const craftSignPos = signPositions?.get('CRAFT');
  test.assert(craftSignPos !== undefined, 'Blackboard signPositions should have CRAFT entry');

  // Verify sharedCraftingTable is set
  const sharedCraftingTable = bb()?.sharedCraftingTable as Vec3 | undefined;
  test.assert(sharedCraftingTable !== undefined, 'Bot should have sharedCraftingTable location set');

  // Verify crafting table is near village center (within 5 blocks)
  const craftingTableDistToVillage = sharedCraftingTable!.distanceTo(villageCenter);
  test.assert(
    craftingTableDistToVillage <= 5,
    `Crafting table should be near village center (dist=${craftingTableDistToVillage.toFixed(1)}, expected <= 5)`
  );

  // Verify CRAFT sign is near spawn (within 5 blocks)
  const signDistToSpawn = craftSignPos!.distanceTo(spawnPos);
  test.assert(
    signDistToSpawn <= 5,
    `CRAFT sign should be near spawn (dist=${signDistToSpawn.toFixed(1)}, expected <= 5)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Avoids planting saplings near known FARM signs
// ═══════════════════════════════════════════════════════════════════════════

async function testAvoidsFarmWhenPlanting() {
  const test = new SimulationTest('Avoids planting saplings near FARM signs');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Farm area that should be avoided
  const farmCenter = new Vec3(10, 63, 10);
  world.setBlock(farmCenter, 'water');
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(10 + dx, 63, 10 + dz), 'farmland');
    }
  }

  // Forest is CLOSE to the farm (only 8 blocks away) - this tests that bot
  // properly avoids farm when planting even when working in nearby forest
  const forestCenter = new Vec3(18, 64, 10);

  // Signs including FARM sign
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 18\nY: 64\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_sapling', count: 5 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: new Vec3(0, 64, 0) });

  const bb = () => (role as any).blackboard;

  // Wait for bot to study signs
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Verify bot learned farm location
  const knownFarms = bb()?.knownFarms || [];
  const hasFarmKnowledge = knownFarms.some((pos: Vec3) =>
    pos.x === 10 && pos.y === 63 && pos.z === 10
  );
  test.assert(hasFarmKnowledge, 'Bot should learn farm at (10, 63, 10)');

  // Wait for bot to plant at least 3 saplings
  await test.waitUntil(
    () => test.botInventoryCount('oak_sapling') <= 2,
    { timeout: 90000, message: 'Bot should plant saplings' }
  );

  role.stop(test.bot);

  // Check that no saplings were planted within 10 blocks of farm
  const plantedSaplings: Vec3[] = [];
  for (let x = -30; x <= 30; x++) {
    for (let z = -30; z <= 30; z++) {
      const block = test.blockAt(new Vec3(x, 64, z));
      if (block && block.includes('sapling')) {
        plantedSaplings.push(new Vec3(x, 64, z));
      }
    }
  }

  const saplingsNearFarm = plantedSaplings.filter(pos =>
    pos.distanceTo(farmCenter) < 10
  );

  test.assertEqual(
    saplingsNearFarm.length,
    0,
    `No saplings should be planted within 10 blocks of farm (found ${saplingsNearFarm.length})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'read-forest': testReadsForestSign,
  'place-forest-sign': testPlacesForestSign,
  'infrastructure': testLearnsInfrastructure,
  'place-chest-sign': testPlacesChestSign,
  'place-craft-sign': testPlacesCraftSign,
  'avoid-farm': testAvoidsFarmWhenPlanting,
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
