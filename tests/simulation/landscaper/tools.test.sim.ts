#!/usr/bin/env bun
/**
 * Landscaper Tools Simulation Tests
 *
 * SPECIFICATION: Landscaper Tool Acquisition
 *
 * Landscapers need TWO tools for terraforming:
 * - Shovel: for dirt, grass, sand, gravel
 * - Pickaxe: for stone, cobblestone, andesite, etc.
 *
 * When missing tools, the landscaper should:
 * 1. Check shared chest for materials
 * 2. Craft missing tools from available materials
 * 3. Prioritize getting tools before doing work
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts shovel from planks and sticks
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsShovelFromMaterials() {
  const test = new SimulationTest('Crafts shovel from planks and sticks');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Crafting table
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // Materials for shovel (1 plank + 2 sticks)
      { name: 'oak_planks', count: 4 },
      { name: 'stick', count: 4 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Verify bot starts without shovel
  const hasInitialShovel = test.bot.inventory.items().some(i => i.name.includes('shovel'));
  console.log(`  🥄 Has shovel initially: ${hasInitialShovel}`);
  test.assert(!hasInitialShovel, 'Bot should start without any shovel');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitUntil(
    () => test.bot.inventory.items().some(item => item.name.includes('_shovel')),
    {
      timeout: 60000,
      message: 'Bot should craft a shovel',
    }
  );

  const shovelItem = test.bot.inventory.items().find(i => i.name.includes('_shovel'));
  console.log(`  🥄 Crafted shovel: ${shovelItem?.name}`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts pickaxe from planks and sticks
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsPickaxeFromMaterials() {
  const test = new SimulationTest('Crafts pickaxe from planks and sticks');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Crafting table
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // Already has shovel, needs pickaxe
      { name: 'iron_shovel', count: 1 },
      // Materials for pickaxe (3 planks + 2 sticks)
      { name: 'oak_planks', count: 6 },
      { name: 'stick', count: 4 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Verify bot starts without pickaxe
  const hasInitialPickaxe = test.bot.inventory.items().some(i => i.name.includes('pickaxe'));
  console.log(`  ⛏️  Has pickaxe initially: ${hasInitialPickaxe}`);
  test.assert(!hasInitialPickaxe, 'Bot should start without any pickaxe');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitUntil(
    () => test.bot.inventory.items().some(item => item.name.includes('_pickaxe')),
    {
      timeout: 60000,
      message: 'Bot should craft a pickaxe',
    }
  );

  const pickaxeItem = test.bot.inventory.items().find(i => i.name.includes('_pickaxe'));
  console.log(`  ⛏️  Crafted pickaxe: ${pickaxeItem?.name}`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts both tools from logs only
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsBothToolsFromLogs() {
  const test = new SimulationTest('Crafts both tools from logs');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // No crafting table placed - bot must place one
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    // Only logs - bot must: logs → planks → sticks → crafting table → tools
    // Shovel: 1 plank + 2 sticks = 1 + 1 = 2 planks
    // Pickaxe: 3 planks + 2 sticks = 3 + 1 = 4 planks
    // Crafting table: 4 planks
    // Total: 10 planks = 3 logs (12 planks)
    botInventory: [
      { name: 'oak_log', count: 8 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Verify bot starts without tools
  const hasTools = test.bot.inventory.items().some(i =>
    i.name.includes('shovel') || i.name.includes('pickaxe')
  );
  console.log(`  🛠️  Has tools initially: ${hasTools}`);
  test.assert(!hasTools, 'Bot should start without any tools');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for BOTH tools to be crafted
  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      const hasShovel = items.some(i => i.name.includes('_shovel'));
      const hasPickaxe = items.some(i => i.name.includes('_pickaxe'));
      return hasShovel && hasPickaxe;
    },
    {
      timeout: 120000,
      message: 'Bot should craft both shovel and pickaxe',
    }
  );

  const shovel = test.bot.inventory.items().find(i => i.name.includes('_shovel'));
  const pickaxe = test.bot.inventory.items().find(i => i.name.includes('_pickaxe'));
  console.log(`  🛠️  Crafted tools: ${shovel?.name}, ${pickaxe?.name}`);

  // Verify crafting table was placed
  const craftingTables = test.bot.findBlocks({
    matching: (block: any) => block.name === 'crafting_table',
    maxDistance: 32,
    count: 1,
  });
  test.assert(
    craftingTables.length > 0,
    'Bot should have placed a crafting table for tool crafting'
  );

  // Verify logs were consumed
  const finalLogs = test.botInventoryCount('oak_log');
  test.assert(
    finalLogs < 8,
    `Bot should have used logs for crafting (was 8, now ${finalLogs})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Checks shared chest for tool materials
// ═══════════════════════════════════════════════════════════════════════════

async function testChecksChestForToolMaterials() {
  const test = new SimulationTest('Checks shared chest for tool materials');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Storage infrastructure
  const chestPos = new Vec3(-5, 64, 0);
  world.setBlock(chestPos, 'chest');
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(3, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    // Bot has NO materials - must get from chest
    botInventory: [],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Stock the chest with materials for tools
  // Shovel: 1 plank + 2 sticks, Pickaxe: 3 planks + 2 sticks
  await test.rcon('data merge block -5 64 0 {Items:[' +
    '{Slot:0b,id:"minecraft:oak_planks",count:16},' +
    '{Slot:1b,id:"minecraft:stick",count:8}' +
    ']}');

  console.log(`  📦 Chest stocked with planks and sticks`);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for bot to obtain at least one tool
  await test.waitUntil(
    () => test.bot.inventory.items().some(i =>
      i.name.includes('_shovel') || i.name.includes('_pickaxe')
    ),
    {
      timeout: 90000,
      message: 'Bot should get materials from chest and craft tools',
    }
  );

  // Verify bot has acquired materials
  const finalPlanks = test.botInventoryCount('oak_planks');
  const finalSticks = test.botInventoryCount('stick');
  const hasShovel = test.bot.inventory.items().some(i => i.name.includes('_shovel'));
  const hasPickaxe = test.bot.inventory.items().some(i => i.name.includes('_pickaxe'));

  console.log(`  🎒 Bot inventory: ${finalPlanks} planks, ${finalSticks} sticks`);
  console.log(`  🛠️  Tools: shovel=${hasShovel}, pickaxe=${hasPickaxe}`);

  test.assert(
    hasShovel || hasPickaxe,
    'Bot should have crafted at least one tool from chest materials'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Prioritizes tools before terraform work
// ═══════════════════════════════════════════════════════════════════════════

async function testPrioritizesToolsBeforeWork() {
  const test = new SimulationTest('Prioritizes tools before terraform work');

  const world = new MockWorld();

  // Farm with issues (holes that need filling)
  const farmCenter = new Vec3(12, 63, 12);
  world.fill(new Vec3(4, 62, 4), new Vec3(20, 62, 20), 'stone');
  world.fill(new Vec3(4, 63, 4), new Vec3(20, 63, 20), 'grass_block');
  world.setBlock(farmCenter, 'water');

  // Create holes in farm
  world.setBlock(new Vec3(10, 63, 12), 'air');
  world.setBlock(new Vec3(14, 63, 12), 'air');

  // Crafting infrastructure
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(3, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 12\nY: 63\nZ: 12' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // Materials for tools but NO tools
      { name: 'oak_planks', count: 8 },
      { name: 'stick', count: 8 },
      { name: 'dirt', count: 16 }, // Has dirt for filling but needs tools first
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Track what happens first
  let gotToolsFirst = false;
  let startedWorkFirst = false;

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Monitor: tools should be obtained BEFORE any terraform work starts
  await test.waitUntil(
    () => {
      const hasShovel = test.bot.inventory.items().some(i => i.name.includes('_shovel'));
      const bb = (role as any).blackboard;
      const terraformActive = bb?.currentTerraformTask?.phase !== undefined;

      if (hasShovel && !startedWorkFirst) {
        gotToolsFirst = true;
      }
      if (terraformActive && !hasShovel) {
        startedWorkFirst = true;
      }

      return hasShovel;
    },
    {
      timeout: 60000,
      message: 'Bot should obtain tools',
    }
  );

  test.assert(
    gotToolsFirst && !startedWorkFirst,
    'Bot should obtain tools before starting terraform work'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'shovel': testCraftsShovelFromMaterials,
  'pickaxe': testCraftsPickaxeFromMaterials,
  'both-tools': testCraftsBothToolsFromLogs,
  'chest-materials': testChecksChestForToolMaterials,
  'tools-first': testPrioritizesToolsBeforeWork,
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
