#!/usr/bin/env bun
/**
 * Landscaper Core Work Simulation Tests
 *
 * SPECIFICATION: Landscaper Core Work
 *
 * The landscaper's primary responsibilities:
 * - Fulfill terraform requests (flattening terrain)
 * - Check known farms for maintenance needs
 * - Maintain farms (fix holes, water issues)
 * - Gather dirt proactively
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Terraforms uneven terrain
// ═══════════════════════════════════════════════════════════════════════════

async function testTerraformsUneven() {
  const test = new SimulationTest('Terraforms uneven terrain');

  const world = new MockWorld();
  world.fill(new Vec3(-25, 63, -25), new Vec3(25, 63, 25), 'grass_block');

  // Uneven terrain that needs flattening
  world.fill(new Vec3(10, 64, 10), new Vec3(14, 65, 14), 'dirt');

  // Water source for farm center
  world.setBlock(new Vec3(12, 63, 12), 'water');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 12\nY: 63\nZ: 12' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Request terraform via chat
  await test.rcon('say [TERRAFORM] 12 63 12');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitUntil(
    () => {
      const block = test.blockAt(new Vec3(12, 64, 12));
      return block === 'air' || block === 'dirt' || block === 'farmland';
    },
    {
      timeout: 120000,
      message: 'Bot should clear blocks above farm level',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Fills holes in farm area
// ═══════════════════════════════════════════════════════════════════════════

async function testFillsHoles() {
  const test = new SimulationTest('Fills holes in farm');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Farm with holes
  const farmCenter = new Vec3(12, 63, 12);
  world.setBlock(farmCenter, 'water');

  // Holes at y=63
  world.setBlock(new Vec3(10, 63, 12), 'air');
  world.setBlock(new Vec3(14, 63, 12), 'air');
  world.setBlock(new Vec3(12, 63, 10), 'air');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 12\nY: 63\nZ: 12' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'dirt', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitUntil(
    () => {
      const block = test.blockAt(new Vec3(10, 63, 12));
      return block !== 'air' && block !== 'water';
    },
    {
      timeout: 90000,
      message: 'Bot should fill hole at 10, 63, 12',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Gathers dirt by digging
// ═══════════════════════════════════════════════════════════════════════════

async function testGathersDirt() {
  const test = new SimulationTest('Gathers dirt by digging');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Extra dirt to dig at y=64
  world.fill(new Vec3(5, 64, 5), new Vec3(10, 64, 10), 'dirt');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_shovel', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  await test.waitForInventory('dirt', 4, {
    timeout: 90000,
    message: 'Bot should gather at least 4 dirt blocks',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'terraform': testTerraformsUneven,
  'holes': testFillsHoles,
  'dirt': testGathersDirt,
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
