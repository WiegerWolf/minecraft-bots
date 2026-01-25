#!/usr/bin/env bun
/**
 * Landscaper Navigation Simulation Tests
 *
 * SPECIFICATION: Landscaper Navigation
 *
 * Landscapers have special navigation needs:
 * - Must craft wooden slabs for scaffolding (pathfinder pillaring/bridging)
 * - Preserve dirt for terraforming (don't use as scaffolding)
 * - Navigate uneven terrain to reach terraform sites
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts slabs for navigation scaffolding
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsSlabsForNavigation() {
  const test = new SimulationTest('Crafts slabs for navigation scaffolding');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Crafting table
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      // Planks for slab crafting (3 planks -> 6 slabs)
      { name: 'oak_planks', count: 12 },
      // No slabs initially
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Verify bot starts without slabs
  const hasInitialSlabs = test.bot.inventory.items().some(i => i.name.includes('_slab'));
  console.log(`  🪵 Has slabs initially: ${hasInitialSlabs}`);
  test.assert(!hasInitialSlabs, 'Bot should start without any slabs');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // CraftSlabs goal activates when idle with planks but no slabs
  await test.waitUntil(
    () => test.bot.inventory.items().some(item => item.name.includes('_slab')),
    {
      timeout: 90000,
      message: 'Bot should craft slabs from planks when idle',
    }
  );

  const slabItem = test.bot.inventory.items().find(i => i.name.includes('_slab'));
  const slabCount = test.bot.inventory.items()
    .filter(i => i.name.includes('_slab'))
    .reduce((sum, i) => sum + i.count, 0);

  console.log(`  🪵 Crafted slabs: ${slabCount}x ${slabItem?.name}`);

  // Verify planks were consumed
  const finalPlanks = test.botInventoryCount('oak_planks');
  test.assert(
    finalPlanks < 12,
    `Bot should have used planks for slabs (was 12, now ${finalPlanks})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Preserves dirt for terraforming (doesn't use as scaffolding)
// ═══════════════════════════════════════════════════════════════════════════

async function testPreservesDirtForTerraforming() {
  const test = new SimulationTest('Preserves dirt for terraforming');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Create a gap that requires bridging/scaffolding
  // Clear a 5-block wide gap
  for (let x = 10; x <= 14; x++) {
    for (let z = -2; z <= 2; z++) {
      world.setBlock(new Vec3(x, 63, z), 'air');
    }
  }

  // Farm on the other side of the gap (to give bot a reason to cross)
  const farmCenter = new Vec3(20, 63, 0);
  world.fill(new Vec3(16, 63, -4), new Vec3(24, 63, 4), 'grass_block');
  world.setBlock(farmCenter, 'water');

  // Create a hole in the farm that needs filling
  world.setBlock(new Vec3(18, 63, 0), 'air');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 20\nY: 63\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(5, 64, 0),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 32 }, // Dirt should be preserved
      { name: 'oak_slab', count: 16 }, // Slabs should be used for bridging
    ],
    clearRadius: 40,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const initialDirt = test.botInventoryCount('dirt');
  const initialSlabs = test.bot.inventory.items()
    .filter(i => i.name.includes('_slab'))
    .reduce((sum, i) => sum + i.count, 0);

  console.log(`  🎒 Initial: ${initialDirt} dirt, ${initialSlabs} slabs`);

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for bot to fill the hole in the farm (proves it crossed the gap)
  await test.waitUntil(
    () => {
      const block = test.blockAt(new Vec3(18, 63, 0));
      return block === 'dirt' || block === 'grass_block';
    },
    {
      timeout: 120000,
      message: 'Bot should cross gap and fill farm hole',
    }
  );

  // Check that dirt was used for FILLING, not scaffolding
  const finalDirt = test.botInventoryCount('dirt');
  const finalSlabs = test.bot.inventory.items()
    .filter(i => i.name.includes('_slab'))
    .reduce((sum, i) => sum + i.count, 0);

  console.log(`  🎒 Final: ${finalDirt} dirt, ${finalSlabs} slabs`);

  // Dirt should be used for the hole fill (1 block)
  // If pathfinder used dirt for bridging, we'd see much more loss
  const dirtUsed = initialDirt - finalDirt;
  test.assert(
    dirtUsed <= 5, // Allow some tolerance for hole filling
    `Dirt should be preserved for terraforming, not scaffolding (used ${dirtUsed}, expected <=5)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Navigates to elevated terraform site
// ═══════════════════════════════════════════════════════════════════════════

async function testNavigatesToElevatedSite() {
  const test = new SimulationTest('Navigates to elevated terraform site');

  const world = new MockWorld();

  // Ground level
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Elevated platform (farm on a hill)
  const hillBase = new Vec3(15, 64, 15);
  // 3-block high hill
  world.fill(new Vec3(12, 64, 12), new Vec3(18, 64, 18), 'dirt');
  world.fill(new Vec3(13, 65, 13), new Vec3(17, 65, 17), 'dirt');
  world.fill(new Vec3(14, 66, 14), new Vec3(16, 66, 16), 'grass_block');

  // Water source on top of the hill
  const farmCenter = new Vec3(15, 66, 15);
  world.setBlock(farmCenter, 'water');

  // Hole in the elevated farm
  world.setBlock(new Vec3(14, 66, 15), 'air');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 66\nZ: 15' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 16 },
      { name: 'oak_slab', count: 16 },
    ],
    clearRadius: 30,
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Wait for bot to reach the elevated farm and fill the hole
  await test.waitUntil(
    () => {
      const block = test.blockAt(new Vec3(14, 66, 15));
      return block === 'dirt' || block === 'grass_block';
    },
    {
      timeout: 120000,
      message: 'Bot should navigate to elevated farm and fill hole',
    }
  );

  // Verify bot actually climbed (or pathfound) to the elevated area
  const botPos = test.botPosition();
  console.log(`  📍 Bot final position: y=${Math.floor(botPos?.y ?? 0)}`);

  // Bot should have reached y=67 (standing on the hill) at some point
  // Since bot might have moved after filling, we just verify the hole is filled
  test.assert(
    test.blockAt(new Vec3(14, 66, 15)) !== 'air',
    'Hole in elevated farm should be filled'
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'slabs': testCraftsSlabsForNavigation,
  'preserve-dirt': testPreservesDirtForTerraforming,
  'elevated': testNavigatesToElevatedSite,
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
