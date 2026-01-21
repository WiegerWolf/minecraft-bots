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

  // Collect chat messages from the bot
  const chatMessages: string[] = [];
  test.bot.on('chat', (username: string, message: string) => {
    if (username === test.bot.username) {
      chatMessages.push(message);
    }
  });

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to study signs (check blackboard hasStudiedSigns flag)
  const bb = () => (role as any).blackboard;
  await test.waitUntil(
    () => bb()?.hasStudiedSigns === true,
    { timeout: 30000, message: 'Bot should study spawn signs' }
  );

  // Verify chat announcement mentions studying signs and the farm
  const hasStudiedAnnouncement = chatMessages.some(msg =>
    msg.toLowerCase().includes('studied') && msg.toLowerCase().includes('farm')
  );
  test.assert(hasStudiedAnnouncement, 'Bot should announce studying farm sign in chat');

  // Verify blackboard has learned farm location
  const knownFarms = bb()?.knownFarms || [];
  const hasFarmKnowledge = knownFarms.some((pos: Vec3) =>
    pos.x === 15 && pos.y === 63 && pos.z === 15
  );
  test.assert(hasFarmKnowledge, 'Bot blackboard should have farm at (15, 63, 15) in knownFarms');

  // Verify sign was marked as read
  const readSignPositions = bb()?.readSignPositions as Set<string> | undefined;
  const farmSignRead = readSignPositions?.has('2,64,0');
  test.assert(farmSignRead === true, 'Bot should mark FARM sign position as read');

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

  // Collect chat messages from the bot
  const chatMessages: string[] = [];
  test.bot.on('chat', (username: string, message: string) => {
    if (username === test.bot.username) {
      chatMessages.push(message);
    }
  });

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

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

  // Verify blackboard learned farm location
  const knownFarms = bb()?.knownFarms || [];
  const hasFarmKnowledge = knownFarms.some((pos: Vec3) =>
    pos.x === 12 && pos.y === 63 && pos.z === 12
  );
  test.assert(hasFarmKnowledge, 'Bot should learn farm at (12, 63, 12)');

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
