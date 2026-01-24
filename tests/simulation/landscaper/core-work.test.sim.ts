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
// TEST: Flattens terrain around farm
// ═══════════════════════════════════════════════════════════════════════════

async function testFlattensTerrain() {
  const test = new SimulationTest('Flattens terrain around farm');

  const world = new MockWorld();

  // Farm center at (12, 63, 12) - the water source
  const farmCenter = new Vec3(12, 63, 12);

  // Build complete ground layer for the 9x9 farm area (radius 4 from center)
  // Farm spans from (8, 63, 8) to (16, 63, 16)
  // Add buffer for path ring and bot movement
  world.fill(new Vec3(4, 62, 4), new Vec3(20, 62, 20), 'stone'); // Solid foundation
  world.fill(new Vec3(4, 63, 4), new Vec3(20, 63, 20), 'grass_block'); // Ground level

  // Water source at farm center - this is what the FARM sign points to
  world.setBlock(farmCenter, 'water');

  // Raised terrain that needs flattening - simulating uneven ground around the farm
  // These blocks at y=64 obstruct the farm area and need to be cleared
  // Position them asymmetrically to test bot handles various positions
  world.setBlock(new Vec3(10, 64, 10), 'dirt');
  world.setBlock(new Vec3(10, 64, 11), 'dirt');
  world.setBlock(new Vec3(10, 64, 12), 'dirt');
  world.setBlock(new Vec3(11, 64, 10), 'dirt');
  world.setBlock(new Vec3(14, 64, 14), 'dirt');
  world.setBlock(new Vec3(14, 64, 13), 'dirt');
  world.setBlock(new Vec3(13, 64, 14), 'dirt');

  // Village sign at spawn area
  world.setBlock(new Vec3(5, 64, 5), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 5' });
  // Farm sign pointing to the water source
  world.setBlock(new Vec3(6, 64, 5), 'oak_sign', { signText: '[FARM]\nX: 12\nY: 63\nZ: 12' });

  await test.setup(world, {
    botPosition: new Vec3(5, 64, 6),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Start the role - it will study signs, learn about the farm, and detect obstacles
  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  🚜 Started landscaper - will flatten terrain around farm');

  // The bot should:
  // 1. Study signs (utility 150) - learns about farm at (12, 63, 12)
  // 2. Detect raised dirt as obstacles via scanFarmForAllIssues
  // 3. Select MaintainFarms goal to fix issues
  // 4. Clear all raised dirt blocks at y=64 within farm area

  // Wait for the raised terrain to be cleared
  await test.waitUntil(
    () => {
      // Check all positions where we placed raised dirt
      const positions = [
        new Vec3(10, 64, 10),
        new Vec3(10, 64, 11),
        new Vec3(10, 64, 12),
        new Vec3(11, 64, 10),
        new Vec3(14, 64, 14),
        new Vec3(14, 64, 13),
        new Vec3(13, 64, 14),
      ];

      const blocks = positions.map(pos => ({ pos, block: test.blockAt(pos) }));
      const remaining = blocks.filter(b => b.block !== 'air');

      if (remaining.length > 0) {
        const summary = remaining.map(b => `(${b.pos.x},${b.pos.z})=${b.block}`).join(', ');
        console.log(`  [check] ${remaining.length} blocks remaining: ${summary}`);
      }

      return remaining.length === 0;
    },
    {
      timeout: 60000,
      interval: 3000,
      message: 'Bot should clear all raised dirt obstacles in farm area',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS - Verify the farm area is properly flattened
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Water source at center must be intact
  const waterBlock = test.blockAt(farmCenter);
  test.assert(waterBlock === 'water', 'Water source at farm center should remain intact');

  // 2. Farm surface (y=63) should be solid ground around water
  const surfacePositions = [
    new Vec3(11, 63, 12), // West of water
    new Vec3(13, 63, 12), // East of water
    new Vec3(12, 63, 11), // North of water
    new Vec3(12, 63, 13), // South of water
  ];
  for (const pos of surfacePositions) {
    const block = test.blockAt(pos);
    test.assert(
      block === 'grass_block' || block === 'dirt' || block === 'farmland',
      `Farm surface at (${pos.x}, ${pos.z}) should be solid (was ${block})`
    );
  }

  // 3. Verify the entire 9x9 area at y=64 is clear (except center above water)
  let clearedCount = 0;
  let totalChecked = 0;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      // Skip center (directly above water)
      if (dx === 0 && dz === 0) continue;

      const pos = new Vec3(farmCenter.x + dx, 64, farmCenter.z + dz);
      const block = test.blockAt(pos);
      totalChecked++;
      if (block === 'air') {
        clearedCount++;
      }
    }
  }

  console.log(`  ✓ Cleared ${clearedCount}/${totalChecked} positions at y=64`);
  test.assert(
    clearedCount === totalChecked,
    `All ${totalChecked} positions above farm should be clear (${clearedCount} were clear)`
  );

  const botPos = test.botPosition();
  if (botPos) {
    console.log(`  📍 Bot final position: (${Math.floor(botPos.x)}, ${Math.floor(botPos.y)}, ${Math.floor(botPos.z)})`);
  }

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
  'flatten': testFlattensTerrain,
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
