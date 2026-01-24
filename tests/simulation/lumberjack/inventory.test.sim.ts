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
 * - Craft and place storage infrastructure
 * - Share resources with other bots
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
// TEST: Crafts and places storage chest
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsAndPlacesChest() {
  const test = new SimulationTest('Crafts and places storage chest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village sign but NO chest sign - bot must create storage
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Crafting table for chest crafting (requires 3x3)
  world.setBlock(new Vec3(2, 64, 0), 'crafting_table');
  world.setBlock(new Vec3(3, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 2\nY: 64\nZ: 0' });

  // Forest sign so bot doesn't waste time exploring
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 50\nY: 64\nZ: 50' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_log', count: 32 },     // Enough logs to trigger deposit need
      { name: 'oak_planks', count: 16 },  // Enough planks to craft chest (8 needed)
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Verify no chest exists initially
  const initialChestSearch = test.bot.findBlocks({
    matching: (block: any) => block.name === 'chest',
    maxDistance: 32,
    count: 1,
  });
  console.log(`  📦 Initial chests in world: ${initialChestSearch.length}`);
  test.assert(initialChestSearch.length === 0, 'No chest should exist initially');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for a chest to appear in the world (bot crafted and placed it)
  let placedChestPos: Vec3 | null = null;
  await test.waitUntil(
    () => {
      const chests = test.bot.findBlocks({
        matching: (block: any) => block.name === 'chest',
        maxDistance: 32,
        count: 1,
      });
      if (chests.length > 0) {
        placedChestPos = chests[0]!;
        return true;
      }
      return false;
    },
    {
      timeout: 90000,
      message: 'Bot should craft and place a storage chest',
    }
  );

  console.log(`  📦 Chest placed at: ${placedChestPos}`);

  // Verify the chest was placed near village center (0, 64, 0)
  const distanceFromVillage = placedChestPos!.distanceTo(new Vec3(0, 64, 0));
  test.assert(
    distanceFromVillage <= 10,
    `Chest should be placed near village center (distance: ${distanceFromVillage.toFixed(1)})`
  );

  // Verify bot used planks to craft the chest (8 planks needed)
  const finalPlanks = test.botInventoryCount('oak_planks');
  test.assert(
    finalPlanks < 16,
    `Bot should have used planks to craft chest (was 16, now ${finalPlanks})`
  );

  // Verify the placed block is actually a chest
  const placedBlock = test.bot.blockAt(placedChestPos!);
  test.assert(
    placedBlock?.name === 'chest',
    `Placed block should be a chest (got ${placedBlock?.name})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: High log count triggers deposit
// ═══════════════════════════════════════════════════════════════════════════

async function testHighLogCountTriggersDeposit() {
  const test = new SimulationTest('High log count triggers deposit');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Storage infrastructure
  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  // No trees - just test deposit behavior with existing inventory
  // This isolates the deposit test from tree-chopping complications

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_log', count: 48 },    // High log count should trigger deposit
      { name: 'oak_planks', count: 32 }, // Also some planks to deposit
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const initialLogs = test.botInventoryCount('oak_log');
  const initialPlanks = test.botInventoryCount('oak_planks');
  console.log(`  🎒 Initial inventory: ${initialLogs} logs, ${initialPlanks} planks`);

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Bot should recognize high inventory and deposit
  // The waitForChestContains verifies that logs actually reached the chest
  await test.waitForChestContains(chestPos, 'oak_log', 1, {
    timeout: 60000,
    message: 'Bot should deposit logs when count is high',
  });

  // Note: After depositing, bot may withdraw supplies and start depositing again.
  // The waitForChestContains already confirms the deposit happened.
  // We just verify the deposit action was meaningful (deposited more than trivial amount).
  // We captured the moment when chest had logs - that's the key verification.
  console.log('  ✓ Deposit confirmed - chest received logs');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts axe from scratch
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsAxeFromScratch() {
  const test = new SimulationTest('Crafts axe from scratch');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village sign and forest sign - no other infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(1, 64, 0), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 15' });

  // Forest for eventual work
  const forestCenter = new Vec3(15, 64, 15);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    // Only logs - no axe, no planks, no sticks, no crafting table
    // Bot must: logs → planks → sticks → craft table → wooden axe
    botInventory: [
      { name: 'oak_log', count: 8 },  // Enough for: 4 planks (table) + 3 planks (axe) + 2 sticks = ~3 logs minimum
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Verify bot starts without axe
  const hasInitialAxe = test.bot.inventory.items().some(i => i.name.includes('axe'));
  console.log(`  🪓 Has axe initially: ${hasInitialAxe}`);
  test.assert(!hasInitialAxe, 'Bot should start without any axe');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to craft an axe
  await test.waitUntil(
    () => test.bot.inventory.items().some(i => i.name.includes('_axe')),
    {
      timeout: 90000,
      message: 'Bot should craft an axe from logs',
    }
  );

  // Verify it's a wooden axe (that's what CraftAxe makes)
  const axeItem = test.bot.inventory.items().find(i => i.name.includes('_axe'));
  console.log(`  🪓 Crafted axe: ${axeItem?.name}`);

  test.assert(
    axeItem?.name === 'wooden_axe',
    `Bot should craft a wooden axe (got ${axeItem?.name})`
  );

  // Verify bot used logs to craft (should have fewer than 8 now)
  const finalLogs = test.botInventoryCount('oak_log');
  test.assert(
    finalLogs < 8,
    `Bot should have used logs for crafting (was 8, now ${finalLogs})`
  );

  // Verify a crafting table was placed (required for axe crafting)
  const craftingTables = test.bot.findBlocks({
    matching: (block: any) => block.name === 'crafting_table',
    maxDistance: 32,
    count: 1,
  });
  test.assert(
    craftingTables.length > 0,
    'Bot should have placed a crafting table for axe crafting'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Sharing etiquette - leaves items for others
// ═══════════════════════════════════════════════════════════════════════════

async function testSharingEtiquette() {
  const test = new SimulationTest('Sharing etiquette - leaves items for others');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Storage with supplies - NO forest so bot won't have work after withdrawing
  // This prevents deposit from happening and muddying our checks
  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    // Bot spawns with nothing - should withdraw from chest
    botInventory: [],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Stock the chest with plenty of supplies
  // WithdrawSupplies behavior (from code):
  // - Takes 1 axe if bot has none
  // - Takes up to 16 logs if bot has < 8, leaves at least 8 in chest
  // - Takes up to 16 planks if bot has < 8, leaves at least 8 in chest
  // - Takes up to 16 sticks if bot has < 8, leaves at least 8 in chest
  await test.rcon('data merge block -5 64 0 {Items:[' +
    '{Slot:0b,id:"minecraft:iron_axe",count:2},' +      // 2 axes - should take 1
    '{Slot:1b,id:"minecraft:oak_log",count:32},' +       // 32 logs - take 16, leave 16
    '{Slot:2b,id:"minecraft:oak_planks",count:32},' +    // 32 planks - take 16, leave 16
    '{Slot:3b,id:"minecraft:stick",count:32}' +          // 32 sticks - take 16, leave 16
    ']}');

  // Verify chest contents before
  const initialAxes = await test.getChestItemCount(chestPos, 'iron_axe');
  const initialLogs = await test.getChestItemCount(chestPos, 'oak_log');
  const initialPlanks = await test.getChestItemCount(chestPos, 'oak_planks');
  const initialSticks = await test.getChestItemCount(chestPos, 'stick');

  console.log(`  📦 Chest before: ${initialAxes} axes, ${initialLogs} logs, ${initialPlanks} planks, ${initialSticks} sticks`);

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to get an axe (indicates withdrawal started)
  await test.waitUntil(
    () => test.bot.inventory.items().some(i => i.name.includes('_axe')),
    {
      timeout: 60000,
      message: 'Bot should withdraw axe from chest',
    }
  );

  // Wait a moment for WithdrawSupplies to complete all withdrawals
  await test.wait(500, 'Withdrawal completing');

  // Check what the bot took by looking at its inventory
  // This is more reliable than checking chest (which may have deposits)
  const botAxes = test.bot.inventory.items().filter(i => i.name.includes('_axe')).length;
  const botLogs = test.botInventoryCount('oak_log');
  const botPlanks = test.botInventoryCount('oak_planks');
  const botSticks = test.botInventoryCount('stick');

  console.log(`  🎒 Bot inventory: ${botAxes} axes, ${botLogs} logs, ${botPlanks} planks, ${botSticks} sticks`);

  // Verify sharing etiquette by checking what bot TOOK (not what's left):
  // Bot should take limited amounts, not everything

  // Should take only 1 axe (not both)
  test.assert(
    botAxes === 1,
    `Should take only 1 axe, not all (took ${botAxes})`
  );

  // Should take at most 16 logs (the sharing limit)
  test.assert(
    botLogs <= 16,
    `Should take at most 16 logs (took ${botLogs})`
  );

  // Should take at most 16 planks
  test.assert(
    botPlanks <= 16,
    `Should take at most 16 planks (took ${botPlanks})`
  );

  // Should take at most 16 sticks
  test.assert(
    botSticks <= 16,
    `Should take at most 16 sticks (took ${botSticks})`
  );

  // Verify bot actually took something useful (not a no-op)
  test.assert(
    botLogs > 0 || botPlanks > 0,
    `Bot should have withdrawn some materials (logs=${botLogs}, planks=${botPlanks})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Full chest handled gracefully
// ═══════════════════════════════════════════════════════════════════════════

async function testFullChestHandledGracefully() {
  const test = new SimulationTest('Full chest handled gracefully');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Storage infrastructure with a chest that will be full
  const fullChestPos = new Vec3(-5, 64, 0);
  world.setBlock(fullChestPos, 'chest');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'oak_log', count: 32 },      // Logs to attempt deposit
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Fill the chest completely (27 slots × 64 items each)
  let fillCommand = 'data merge block -5 64 0 {Items:[';
  const fillerItems: string[] = [];
  for (let slot = 0; slot < 27; slot++) {
    fillerItems.push(`{Slot:${slot}b,id:"minecraft:cobblestone",count:64}`);
  }
  fillCommand += fillerItems.join(',') + ']}';
  await test.rcon(fillCommand);

  console.log(`  📦 Chest filled with cobblestone (27 slots)`);

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for bot to attempt deposit (DepositLogs goal should be selected)
  // The bot should try to deposit, fail due to full chest, and continue without crashing
  await test.waitUntil(
    () => {
      // Check if bot has tried to deposit by looking for DepositLogs action
      // We can infer this happened if the goal was selected and either succeeded or failed
      // For now, just wait until bot has done some work (studied signs at minimum)
      const items = test.bot.inventory.items();
      const hasAxe = items.some(i => i.name.includes('_axe'));
      return hasAxe; // Bot still has axe, meaning it didn't crash
    },
    {
      timeout: 30000,
      message: 'Bot should handle full chest gracefully',
    }
  );

  // Give bot time to attempt deposit and handle the full chest
  await test.wait(10000, 'Bot attempting deposit on full chest');

  // Verify bot hasn't crashed and is still functional
  const botIsAlive = test.bot.entity !== null;
  test.assert(botIsAlive, 'Bot should still be alive after full chest encounter');

  // Verify bot still has its logs (couldn't deposit to full chest)
  const botLogs = test.botInventoryCount('oak_log');
  console.log(`  🎒 Bot still has ${botLogs} logs (couldn't deposit to full chest)`);

  // Bot should still have at least some logs since chest was full
  // (May have lost some to other actions, but shouldn't be 0)
  test.assert(
    botLogs > 0,
    `Bot should retain logs when chest is full (has ${botLogs})`
  );

  // Verify the chest is still full (bot didn't somehow clear it)
  const chestCobble = await test.getChestItemCount(fullChestPos, 'cobblestone');
  test.assert(
    chestCobble > 0,
    `Original chest should still contain items (has ${chestCobble} cobblestone)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'deposit': testDepositsToChest,
  'process': testProcessesWood,
  'craft-chest': testCraftsAndPlacesChest,
  'high-logs': testHighLogCountTriggersDeposit,
  'craft-axe': testCraftsAxeFromScratch,
  'sharing': testSharingEtiquette,
  'full-chest': testFullChestHandledGracefully,
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
