#!/usr/bin/env bun
/**
 * Lumberjack Inventory Simulation Tests
 *
 * SPECIFICATION: Lumberjack Inventory Management
 *
 * Lumberjacks must manage inventory:
 * - Collect drops before they despawn
 * - Deposit logs/planks at thresholds
 * - Process wood into planks when needed
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Deposits logs to chest
// ═══════════════════════════════════════════════════════════════════════════

async function testDepositsToChest() {
  const test = new SimulationTest('Deposits logs to chest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Chest for deposits
  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_log', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Debug: verify signs are placed correctly in the world
  console.log('  🔍 Verifying sign placement:');
  await test.debugSign(new Vec3(0, 64, 0), 'VILLAGE');
  await test.debugSign(new Vec3(2, 64, 0), 'CHEST');

  // Verify chest starts empty
  const initialChestLogs = await test.getChestItemCount(chestPos, 'oak_log');
  console.log(`  📦 Initial chest logs: ${initialChestLogs}`);

  const initialBotLogs = test.botInventoryCount('oak_log');
  console.log(`  🎒 Initial bot logs: ${initialBotLogs}`);

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for items to appear in chest (stronger assertion than inventory decrease)
  const depositSuccess = await test.waitForChestContains(chestPos, 'oak_log', 1, {
    timeout: 60000,
    message: 'Chest should receive deposited logs',
  });

  // Also verify bot inventory decreased
  const finalBotLogs = test.botInventoryCount('oak_log');
  const finalChestLogs = await test.getChestItemCount(chestPos, 'oak_log');

  console.log(`  📊 Final state: bot=${finalBotLogs} logs, chest=${finalChestLogs} logs`);

  test.assert(
    finalBotLogs < initialBotLogs,
    `Bot inventory should decrease (was ${initialBotLogs}, now ${finalBotLogs})`
  );

  test.assertGreater(
    finalChestLogs,
    0,
    `Chest should contain logs (has ${finalChestLogs})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Processes wood into planks
// ═══════════════════════════════════════════════════════════════════════════

async function testProcessesWood() {
  const test = new SimulationTest('Processes wood into planks');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_log', count: 8 },
      // No planks - should process
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  await test.waitUntil(
    () => test.botInventoryCount('oak_planks') > 0,
    {
      timeout: 60000,
      message: 'Bot should process logs into planks',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Drops interrupt work
// ═══════════════════════════════════════════════════════════════════════════

async function testDropsInterruptWork() {
  const test = new SimulationTest('Drops interrupt work');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Tree far away
  createOakTree(world, new Vec3(15, 64, 15), 5);

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to start moving toward tree
  await test.wait(3000, 'Bot starting work');

  // Spawn drops near bot - should interrupt
  await test.rcon('summon item 4 65 4 {Item:{id:"minecraft:oak_log",count:5}}');

  await test.waitForInventory('oak_log', 5, {
    timeout: 30000,
    message: 'Bot should collect dropped logs (interrupting tree walking)',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'deposit': testDepositsToChest,
  'process': testProcessesWood,
  'interrupt': testDropsInterruptWork,
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
