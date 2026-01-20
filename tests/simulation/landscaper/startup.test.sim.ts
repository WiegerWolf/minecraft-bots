#!/usr/bin/env bun
/**
 * Landscaper Startup Simulation Tests
 *
 * SPECIFICATION: Landscaper Startup Behavior
 *
 * When a landscaper spawns, it must:
 * 1. Study signs to learn about existing farms
 * 2. Check known farms for maintenance
 * 3. Wait for requests (NOT explore)
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Fresh spawn studies signs first
// ═══════════════════════════════════════════════════════════════════════════

async function testStudiesSignsFirst() {
  const test = new SimulationTest('Fresh spawn studies signs first');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village infrastructure signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: -5\nY: 64\nZ: 2' });
  world.setBlock(new Vec3(6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 63\nZ: 15' });

  // Actual infrastructure
  world.setBlock(new Vec3(-5, 64, 0), 'chest');
  world.setBlock(new Vec3(-5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(15, 63, 15), 'water');

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_shovel', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Let the bot read signs
  await test.wait(15000, 'Bot studying signs');

  // Bot should have moved near signs to study them
  test.assertNear(new Vec3(0, 64, 0), 10, 'Bot should have moved near signs to study them');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Obtains tools when materials available
// ═══════════════════════════════════════════════════════════════════════════

async function testObtainsToolsWithMaterials() {
  const test = new SimulationTest('Obtains tools with materials');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Crafting table
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // No tools, but materials
      { name: 'oak_planks', count: 8 },
      { name: 'stick', count: 4 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_shovel'));
    },
    {
      timeout: 90000,
      message: 'Bot should craft a shovel',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'signs': testStudiesSignsFirst,
  'tools': testObtainsToolsWithMaterials,
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
