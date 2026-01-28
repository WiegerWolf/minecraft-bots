#!/usr/bin/env bun
/**
 * Farmer Inventory Simulation Tests
 *
 * SPECIFICATION: Farmer Inventory Management
 *
 * Farmers must manage inventory for continuous operation:
 * - Collect drops before they despawn (urgent)
 * - Deposit produce at thresholds
 * - Drops interrupt normal work
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

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
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  // Spread 10 seeds across the map at various distances from the bot
  // Bot starts at (0, 64, 0), seeds are placed far enough to require navigation
  const seedPositions = [
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

  for (const pos of seedPositions) {
    await test.rcon(`summon item ${pos.x} 64 ${pos.z} {Item:{id:"minecraft:wheat_seeds",count:1}}`);
  }

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  await test.waitForInventory('wheat_seeds', 10, {
    timeout: 60000,
    message: 'Bot should collect all 10 scattered wheat seeds',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Deposits produce to chest
// ═══════════════════════════════════════════════════════════════════════════

async function testDepositsToChest() {
  const test = new SimulationTest('Deposits produce to chest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm center
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Chest for deposits
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat', count: 32 },
    ],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const initialWheat = test.botInventoryCount('wheat');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  await test.waitUntil(
    () => test.botInventoryCount('wheat') < initialWheat,
    {
      timeout: 60000,
      message: 'Bot should deposit wheat to chest',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Drops interrupt farming work
// ═══════════════════════════════════════════════════════════════════════════

async function testDropsInterruptWork() {
  const test = new SimulationTest('Drops interrupt farming work');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(0, 63, 0), 'water');

  // Create farmland with immature wheat (bot will want to explore/wait)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(dx, 63, dz), 'farmland');
      world.setBlock(new Vec3(dx, 64, dz), 'wheat[age=3]');
    }
  }

  world.setBlock(new Vec3(-5, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-5, 64, 2), 'oak_sign', { signText: '[FARM]\nX: 0\nY: 63\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for sign study
  await test.wait(5000, 'Sign study');

  // Spawn drops - should interrupt any other activity
  await test.rcon('summon item 2 64 2 {Item:{id:"minecraft:wheat",count:10}}');
  await test.rcon('summon item 2 64 2 {Item:{id:"minecraft:wheat_seeds",count:20}}');

  await test.waitForInventory('wheat', 10, {
    timeout: 30000,
    message: 'Bot should collect dropped wheat (interrupting other work)',
  });

  await test.waitForInventory('wheat_seeds', 10, {
    timeout: 30000,
    message: 'Bot should collect dropped seeds',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'drops': testCollectsDrops,
  'deposit': testDepositsToChest,
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
