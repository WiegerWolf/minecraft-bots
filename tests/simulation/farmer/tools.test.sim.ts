#!/usr/bin/env bun
/**
 * Farmer Tools Simulation Tests
 *
 * SPECIFICATION: Farmer Tool Acquisition
 *
 * Farmers need a hoe to till ground. They must:
 * - Craft a hoe when needed
 * - Get materials from storage if available
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts hoe when needed
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsHoe() {
  const test = new SimulationTest('Crafts hoe when needed');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Crafting table
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      // No hoe! But materials to craft one
      { name: 'oak_planks', count: 8 },
      { name: 'stick', count: 4 },
      { name: 'wheat_seeds', count: 20 },
    ],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_hoe'));
    },
    {
      timeout: 90000,
      message: 'Bot should craft a hoe',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Obtains hoe from storage
// ═══════════════════════════════════════════════════════════════════════════

async function testObtainsHoeFromStorage() {
  const test = new SimulationTest('Obtains hoe from storage');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Chest that will contain a hoe
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'wheat_seeds', count: 20 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  // Put a hoe in the chest via RCON
  await test.rcon('data merge block -5 64 0 {Items:[{Slot:0b,id:"minecraft:iron_hoe",count:1}]}');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_hoe'));
    },
    {
      timeout: 90000,
      message: 'Bot should obtain hoe from chest',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Crafts hoe from logs in storage
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsHoeFromLogs() {
  const test = new SimulationTest('Crafts hoe from logs in storage');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Crafting table (needed for hoe recipe)
  world.setBlock(new Vec3(5, 64, 0), 'crafting_table');

  // Chest that will contain logs
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'wheat_seeds', count: 20 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  // Put logs in the chest (2 logs = 8 planks, enough for hoe + sticks)
  await test.rcon('data merge block -5 64 0 {Items:[{Slot:0b,id:"minecraft:oak_log",count:2}]}');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Bot should: withdraw logs → craft planks → craft sticks → craft hoe
  await test.waitUntil(
    () => {
      const items = test.bot.inventory.items();
      return items.some(item => item.name.includes('_hoe'));
    },
    {
      timeout: 120000,
      message: 'Bot should craft hoe from logs',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'craft': testCraftsHoe,
  'storage': testObtainsHoeFromStorage,
  'logs-to-hoe': testCraftsHoeFromLogs,
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
