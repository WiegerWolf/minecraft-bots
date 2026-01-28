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
import pathfinder from 'baritone-ts';
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

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
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

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });

  // Place the chest via RCON with destroy to clear any existing data
  await test.rcon(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} minecraft:chest destroy`);

  await test.wait(2000, 'World loading');

  // Debug: verify signs are placed correctly in the world
  console.log('  🔍 Verifying sign placement:');
  await test.debugSign(new Vec3(0, 64, 0), 'VILLAGE');
  await test.debugSign(new Vec3(2, 64, 0), 'CHEST');

  const initialEmptySlots = test.bot.inventory.emptySlotCount();
  console.log(`  🎒 Initial empty slots: ${initialEmptySlots}`);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for empty slots to increase - this is the real signal that deposit happened
  await test.waitUntil(
    () => test.bot.inventory.emptySlotCount() > initialEmptySlots,
    {
      timeout: 60000,
      message: 'Bot should deposit items to chest',
    }
  );

  const finalEmptySlots = test.bot.inventory.emptySlotCount();
  const finalChestDirt = await test.getChestItemCount(chestPos, 'dirt');
  const finalChestCobble = await test.getChestItemCount(chestPos, 'cobblestone');

  console.log(`  📊 Final state: empty slots=${initialEmptySlots}→${finalEmptySlots} | chest=${finalChestDirt} dirt, ${finalChestCobble} cobble`);

  test.assertGreater(
    finalEmptySlots,
    initialEmptySlots,
    `Bot inventory should have more empty slots (was ${initialEmptySlots}, now ${finalEmptySlots})`
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
// TEST: High item count triggers deposit
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Deposit Threshold
//
// When dirt + cobblestone count exceeds threshold, bot should deposit.
// This test verifies the DepositItemsGoal utility calculation.

async function testHighItemCountTriggersDeposit() {
  const test = new SimulationTest('High item count triggers deposit');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 64 },       // High dirt count
      { name: 'cobblestone', count: 64 }, // High cobble count
    ],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });

  // Place chest via RCON with destroy to clear any existing data
  await test.rcon(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} minecraft:chest destroy`);
  await test.wait(2000, 'World loading');

  const initialEmptySlots = test.bot.inventory.emptySlotCount();
  console.log(`  🎒 Initial empty slots: ${initialEmptySlots}`);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for empty slots to increase - this is the real signal that deposit happened
  await test.waitUntil(
    () => test.bot.inventory.emptySlotCount() > initialEmptySlots,
    {
      timeout: 60000,
      message: 'Bot should deposit dirt when inventory is high',
    }
  );

  const finalEmptySlots = test.bot.inventory.emptySlotCount();
  const chestDirt = await test.getChestItemCount(chestPos, 'dirt');
  const chestCobble = await test.getChestItemCount(chestPos, 'cobblestone');

  console.log(`  📊 Final: empty slots=${initialEmptySlots}→${finalEmptySlots} | chest=${chestDirt} dirt, ${chestCobble} cobble`);

  test.assertGreater(
    finalEmptySlots,
    initialEmptySlots,
    `Bot inventory should have more empty slots after deposit`
  );

  test.assertGreater(
    chestDirt + chestCobble,
    0,
    `Chest should contain deposited items`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Inventory full triggers urgent deposit
// ═══════════════════════════════════════════════════════════════════════════

async function testFullInventoryTriggersDeposit() {
  const test = new SimulationTest('Full inventory triggers urgent deposit');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  // Fill most inventory slots to simulate near-full inventory
  const inventoryItems = [
    { name: 'iron_shovel', count: 1 },
    { name: 'iron_pickaxe', count: 1 },
    { name: 'dirt', count: 64 },
    { name: 'dirt', count: 64 },
    { name: 'cobblestone', count: 64 },
    { name: 'cobblestone', count: 64 },
    { name: 'oak_planks', count: 64 },
    { name: 'oak_planks', count: 64 },
    { name: 'stone', count: 64 },
    { name: 'stone', count: 64 },
    { name: 'gravel', count: 64 },
    { name: 'sand', count: 64 },
  ];

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: inventoryItems,
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  // Clear and place chest fresh (destroy=true removes any existing block data)
  await test.rcon(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} minecraft:chest destroy`);
  await test.wait(2000, 'World loading');

  const initialEmptySlots = test.bot.inventory.emptySlotCount();
  console.log(`  🎒 Empty slots before: ${initialEmptySlots}`);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for empty slots to increase - this is the real signal that deposit happened
  await test.waitUntil(
    () => test.bot.inventory.emptySlotCount() > initialEmptySlots,
    {
      timeout: 60000,
      message: 'Bot should urgently deposit when inventory nearly full',
    }
  );

  const finalEmptySlots = test.bot.inventory.emptySlotCount();
  console.log(`  🎒 Empty slots after: ${finalEmptySlots}`);

  test.assertGreater(
    finalEmptySlots,
    initialEmptySlots,
    'Bot should have more empty slots after depositing'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Preserves tools when depositing
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Tool Preservation
//
// When depositing items, the landscaper should NEVER deposit its tools
// (shovel, pickaxe). Only dirt, cobblestone, and other materials.

async function testPreservesToolsWhenDepositing() {
  const test = new SimulationTest('Preserves tools when depositing');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 128 }, // High count to trigger deposit
      { name: 'cobblestone', count: 64 },
    ],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.rcon(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} minecraft:chest destroy`);
  await test.wait(2000, 'World loading');

  const initialEmptySlots = test.bot.inventory.emptySlotCount();

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for deposit (empty slots increase)
  await test.waitUntil(
    () => test.bot.inventory.emptySlotCount() > initialEmptySlots,
    {
      timeout: 60000,
      message: 'Bot should deposit dirt',
    }
  );

  // Verify tools are still in inventory
  const hasShovel = test.bot.inventory.items().some(i => i.name.includes('_shovel'));
  const hasPickaxe = test.bot.inventory.items().some(i => i.name.includes('_pickaxe'));

  console.log(`  🛠️  After deposit: shovel=${hasShovel}, pickaxe=${hasPickaxe}`);

  test.assert(hasShovel, 'Bot should still have shovel after depositing');
  test.assert(hasPickaxe, 'Bot should still have pickaxe after depositing');

  // Verify chest does NOT contain tools
  const chestShovels = await test.getChestItemCount(chestPos, 'iron_shovel');
  const chestPickaxes = await test.getChestItemCount(chestPos, 'iron_pickaxe');

  test.assert(
    chestShovels === 0 && chestPickaxes === 0,
    `Chest should not contain tools (found ${chestShovels} shovels, ${chestPickaxes} pickaxes)`
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
  'high-count': testHighItemCountTriggersDeposit,
  'full-inv': testFullInventoryTriggersDeposit,
  'preserve-tools': testPreservesToolsWhenDepositing,
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
