#!/usr/bin/env bun
/**
 * Landscaper Inventory Simulation Tests
 *
 * SPECIFICATION: Landscaper Inventory Management
 *
 * Landscapers must manage inventory:
 * - Collect drops before they despawn
 * - Deposit excess items to chest
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Collects dropped items
// ═══════════════════════════════════════════════════════════════════════════

async function testCollectsDrops() {
  const test = new SimulationTest('Collects dropped items');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [{ name: 'iron_shovel', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Spread 10 dirt drops across the map at various distances from the bot
  // Bot starts at (0, 64, 0), dirt is placed far enough to require navigation
  const dirtPositions = [
    { x: 8, z: 0 },    // East
    { x: -8, z: 0 },   // West
    { x: 0, z: 8 },    // South
    { x: 0, z: -8 },   // North
    { x: 6, z: 6 },    // SE
    { x: -6, z: 6 },   // SW
    { x: 6, z: -6 },   // NE
    { x: -6, z: -6 },  // NW
    { x: 10, z: 5 },   // Far east
    { x: -10, z: -5 }, // Far west
  ];

  for (const pos of dirtPositions) {
    await test.rcon(`summon item ${pos.x} 64 ${pos.z} {Item:{id:"minecraft:dirt",count:1}}`);
  }

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitForInventory('dirt', 10, {
    timeout: 60000,
    message: 'Bot should collect all 10 scattered dirt drops',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Deposits items to chest
// ═══════════════════════════════════════════════════════════════════════════

async function testDepositsToChest() {
  const test = new SimulationTest('Deposits items to chest');

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
      { name: 'iron_shovel', count: 1 },
      { name: 'dirt', count: 64 },
      { name: 'cobblestone', count: 64 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);

  // Place the chest via RCON (MockWorld doesn't translate chests to server)
  await test.rcon(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} minecraft:chest`);

  await test.wait(2000, 'World loading');

  // Debug: verify signs are placed correctly in the world
  console.log('  🔍 Verifying sign placement:');
  await test.debugSign(new Vec3(0, 64, 0), 'VILLAGE');
  await test.debugSign(new Vec3(2, 64, 0), 'CHEST');

  // Verify chest starts empty
  const initialChestDirt = await test.getChestItemCount(chestPos, 'dirt');
  const initialChestCobble = await test.getChestItemCount(chestPos, 'cobblestone');
  console.log(`  📦 Initial chest: ${initialChestDirt} dirt, ${initialChestCobble} cobblestone`);

  const initialBotDirt = test.botInventoryCount('dirt');
  const initialBotCobble = test.botInventoryCount('cobblestone');
  console.log(`  🎒 Initial bot: ${initialBotDirt} dirt, ${initialBotCobble} cobblestone`);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for items to appear in chest (stronger assertion than inventory decrease)
  const depositSuccess = await test.waitForChestContains(chestPos, 'dirt', 1, {
    timeout: 60000,
    message: 'Chest should receive deposited dirt',
  });

  // Also verify bot inventory decreased
  const finalBotDirt = test.botInventoryCount('dirt');
  const finalBotCobble = test.botInventoryCount('cobblestone');
  const finalChestDirt = await test.getChestItemCount(chestPos, 'dirt');
  const finalChestCobble = await test.getChestItemCount(chestPos, 'cobblestone');

  console.log(`  📊 Final state: bot=${finalBotDirt} dirt, ${finalBotCobble} cobble | chest=${finalChestDirt} dirt, ${finalChestCobble} cobble`);

  test.assert(
    finalBotDirt < initialBotDirt || finalBotCobble < initialBotCobble,
    `Bot inventory should decrease (dirt: ${initialBotDirt}→${finalBotDirt}, cobble: ${initialBotCobble}→${finalBotCobble})`
  );

  test.assertGreater(
    finalChestDirt + finalChestCobble,
    0,
    `Chest should contain items (has ${finalChestDirt} dirt, ${finalChestCobble} cobble)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'drops': testCollectsDrops,
  'deposit': testDepositsToChest,
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
