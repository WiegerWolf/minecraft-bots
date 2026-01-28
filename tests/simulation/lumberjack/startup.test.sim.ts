#!/usr/bin/env bun
/**
 * Lumberjack Startup Simulation Tests
 *
 * SPECIFICATION: Lumberjack Startup Behavior
 *
 * When a lumberjack spawns, it must:
 * 1. Study signs to learn about existing infrastructure
 * 2. Check storage for supplies (especially axe)
 * 3. Proceed to normal work
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Checks storage after signs if available
// ═══════════════════════════════════════════════════════════════════════════

async function testChecksStorageAfterSigns() {
  const test = new SimulationTest('Checks storage after signs');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  // Forest for work
  createOakTree(world, new Vec3(15, 64, 15), 5);

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [], // No axe - should try to get from storage
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  // Put an axe in the chest
  await test.rcon('data merge block -5 64 0 {Items:[{Slot:0b,id:"minecraft:iron_axe",count:1}]}');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Bot should get axe from storage
  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_axe'));
    },
    {
      timeout: 90000,
      message: 'Bot should obtain axe from storage',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Full startup sequence
// ═══════════════════════════════════════════════════════════════════════════

async function testFullStartupSequence() {
  const test = new SimulationTest('Full startup sequence');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Village sign
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Forest cluster
  const forestCenter = new Vec3(15, 64, 15);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 5);

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack') });

  // Bot should complete startup and start collecting logs
  await test.waitForInventory('oak_log', 1, {
    timeout: 90000,
    message: 'Bot should complete startup and collect logs',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'storage': testChecksStorageAfterSigns,
  'full': testFullStartupSequence,
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
