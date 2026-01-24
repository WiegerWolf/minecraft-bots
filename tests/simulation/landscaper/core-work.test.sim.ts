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

  // Farm center at (12, 63, 12)
  const farmCenter = new Vec3(12, 63, 12);

  // Build complete ground with foundation
  world.fill(new Vec3(4, 62, 4), new Vec3(20, 62, 20), 'stone'); // Solid foundation
  world.fill(new Vec3(4, 63, 4), new Vec3(20, 63, 20), 'grass_block'); // Ground level

  // Water source at farm center
  world.setBlock(farmCenter, 'water');

  // Create holes in the farm area at y=63 (these need to be filled)
  // Spread them around the farm to test the bot handles multiple locations
  const holePositions = [
    new Vec3(10, 63, 12), // West side
    new Vec3(14, 63, 12), // East side
    new Vec3(12, 63, 10), // North side
    new Vec3(12, 63, 14), // South side
    new Vec3(9, 63, 9),   // Corner
  ];

  for (const pos of holePositions) {
    world.setBlock(pos, 'air');
  }

  // Village and farm signs
  world.setBlock(new Vec3(5, 64, 5), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 5' });
  world.setBlock(new Vec3(6, 64, 5), 'oak_sign', { signText: '[FARM]\nX: 12\nY: 63\nZ: 12' });

  await test.setup(world, {
    botPosition: new Vec3(5, 64, 6),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'dirt', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log(`  🕳️  Created ${holePositions.length} holes in farm area - bot should fill all`);

  // Wait for ALL holes to be filled
  await test.waitUntil(
    () => {
      const remaining = holePositions.filter(pos => {
        const block = test.blockAt(pos);
        return block === 'air';
      });

      if (remaining.length > 0) {
        const summary = remaining.map(p => `(${p.x},${p.z})`).join(', ');
        console.log(`  [check] ${remaining.length} holes remaining: ${summary}`);
      }

      return remaining.length === 0;
    },
    {
      timeout: 90000,
      interval: 3000,
      message: 'Bot should fill all holes in farm area',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Verify all holes are filled with solid blocks
  for (const pos of holePositions) {
    const block = test.blockAt(pos);
    test.assert(
      block === 'dirt' || block === 'grass_block' || block === 'farmland',
      `Hole at (${pos.x}, ${pos.z}) should be filled (was ${block})`
    );
  }

  // 2. Water source at center must be intact
  const waterBlock = test.blockAt(farmCenter);
  test.assert(waterBlock === 'water', 'Water source at farm center should remain intact');

  // 3. Verify the entire 9x9 farm surface is solid (no holes)
  let solidCount = 0;
  let totalChecked = 0;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      // Skip center (water)
      if (dx === 0 && dz === 0) continue;

      const pos = new Vec3(farmCenter.x + dx, 63, farmCenter.z + dz);
      const block = test.blockAt(pos);
      totalChecked++;
      if (block === 'dirt' || block === 'grass_block' || block === 'farmland') {
        solidCount++;
      }
    }
  }

  console.log(`  ✓ Farm surface: ${solidCount}/${totalChecked} positions are solid`);
  test.assert(
    solidCount === totalChecked,
    `All ${totalChecked} farm surface positions should be solid (${solidCount} were solid)`
  );

  const botPos = test.botPosition();
  if (botPos) {
    console.log(`  📍 Bot final position: (${Math.floor(botPos.x)}, ${Math.floor(botPos.y)}, ${Math.floor(botPos.z)})`);
  }

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Gathers dirt by digging
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Landscaper Dirt Gathering
//
// The landscaper gathers dirt proactively to prepare for terraform requests.
// This test uses a pre-placed DIRTPIT sign so the bot learns the location
// during sign study (testing the core gathering behavior without establishment).
//
// The dirt gathering flow is:
// 1. StudySpawnSigns (utility 150) - Learn village center and dirtpit location
// 2. GatherDirt (utility 30-50) - Dig dirt from the known dirtpit area
//
// GatherDirt requirements:
// - Bot must have a shovel
// - Bot must know a dirtpit location (from sign or establishment)
// - Dirtpit area must have accessible dirt/grass blocks (air above)

async function testGathersDirt() {
  const test = new SimulationTest('Gathers dirt by digging');

  const world = new MockWorld();

  // Village center at spawn area
  const villageCenter = new Vec3(0, 64, 0);

  // Dirtpit area - use a pre-placed DIRTPIT sign so bot learns location directly
  // This tests the core dirt gathering without the complexity of dirtpit establishment
  const dirtpitCenter = new Vec3(30, 63, 30);

  // Create a compact dirt area at the dirtpit center for testing
  // Place dirt at y=64 (above the default grass at y=63) for easy digging
  // Using a 5x5 area - enough for testing continuous digging pattern
  const dirtRadius = 2;
  world.fill(
    new Vec3(dirtpitCenter.x - dirtRadius, 64, dirtpitCenter.z - dirtRadius),
    new Vec3(dirtpitCenter.x + dirtRadius, 64, dirtpitCenter.z + dirtRadius),
    'dirt'
  );

  // Village sign at spawn
  world.setBlock(new Vec3(2, 64, 2), 'oak_sign', {
    signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}`,
  });

  // DIRTPIT sign - bot learns this location instead of establishing one
  world.setBlock(new Vec3(3, 64, 2), 'oak_sign', {
    signText: `[DIRTPIT]\nX: ${dirtpitCenter.x}\nY: ${dirtpitCenter.y}\nZ: ${dirtpitCenter.z}`,
  });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 3),
    botInventory: [{ name: 'iron_shovel', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  📋 Dirt gathering flow:');
  console.log('     1. StudySpawnSigns - Learn village center and dirtpit location');
  console.log('     2. GatherDirt - Dig dirt from dirtpit area');
  console.log(`  🏘️  Village center: (${villageCenter.x}, ${villageCenter.y}, ${villageCenter.z})`);
  console.log(`  🕳️  Dirtpit location: (${dirtpitCenter.x}, ${dirtpitCenter.y}, ${dirtpitCenter.z})`);

  // Track progress through the phases
  let hasStudiedSigns = false;
  let hasDirtpit = false;
  let lastDirtCount = 0;

  await test.waitUntil(
    () => {
      const bb = (role as any).blackboard;
      if (!bb) return false;

      // Track phase transitions
      if (!hasStudiedSigns && bb.hasStudiedSigns) {
        hasStudiedSigns = true;
        console.log('  ✓ Studied signs - learned village center and dirtpit');
      }

      if (!hasDirtpit && bb.hasDirtpit) {
        hasDirtpit = true;
        const pos = bb.dirtpit;
        console.log(`  ✓ Dirtpit known at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`);
      }

      // Check dirt in inventory - only log when count changes
      const dirtCount = bb.dirtCount || 0;
      if (dirtCount > lastDirtCount) {
        console.log(`  [progress] Gathered ${dirtCount}/4 dirt`);
        lastDirtCount = dirtCount;
      }

      return dirtCount >= 4;
    },
    {
      timeout: 90000,
      interval: 2000,
      message: 'Bot should gather at least 4 dirt blocks',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const bb = (role as any).blackboard;

  // 1. Signs should have been studied
  test.assert(bb.hasStudiedSigns === true, 'Bot should have studied spawn signs');

  // 2. Dirtpit should be known (learned from sign)
  test.assert(bb.hasDirtpit === true, 'Bot should have learned dirtpit location from sign');

  // 3. Should have gathered dirt
  const finalDirtCount = bb.dirtCount || 0;
  test.assert(finalDirtCount >= 4, `Bot should have at least 4 dirt (had ${finalDirtCount})`);
  console.log(`  ✓ Gathered ${finalDirtCount} dirt blocks`);

  const botPos = test.botPosition();
  if (botPos) {
    console.log(`  📍 Bot final position: (${Math.floor(botPos.x)}, ${Math.floor(botPos.y)}, ${Math.floor(botPos.z)})`);
  }

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
