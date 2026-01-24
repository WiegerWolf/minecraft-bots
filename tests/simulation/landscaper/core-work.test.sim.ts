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
// TEST: Gathers dirt to fill farm holes
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Landscaper Dirt Gathering
//
// Tests that the landscaper will gather dirt when needed for farm maintenance.
// The bot discovers a farm with holes but has NO dirt - it must dig dirt first.
//
// Scenario:
// 1. Farm exists with holes that need filling
// 2. Bot has shovel but NO dirt
// 3. Dirtpit is available nearby
// 4. Bot should: study signs → detect farm issues → gather dirt → fill holes

async function testGathersDirt() {
  const test = new SimulationTest('Gathers dirt to fill farm holes');

  const world = new MockWorld();

  // Village center at origin
  const villageCenter = new Vec3(0, 64, 0);

  // Farm near village (within normal village bounds)
  const farmCenter = new Vec3(15, 63, 15);

  // Build farm ground
  world.fill(new Vec3(11, 62, 11), new Vec3(19, 62, 19), 'stone'); // Foundation
  world.fill(new Vec3(11, 63, 11), new Vec3(19, 63, 19), 'dirt');  // Farm surface

  // Water source at farm center
  world.setBlock(farmCenter, 'water');

  // Create holes in the farm (these need dirt to fill)
  const holePositions = [
    new Vec3(13, 63, 15),
    new Vec3(17, 63, 15),
    new Vec3(15, 63, 13),
  ];
  for (const pos of holePositions) {
    world.setBlock(pos, 'air');
  }

  // Dirtpit area - MUST be:
  // - 50+ blocks from village (0,0)
  // - 30+ blocks from farm (15,15)
  // Place at (60, 63, 60): ~85 blocks from village, ~64 blocks from farm
  const dirtpitCenter = new Vec3(60, 63, 60);
  world.fill(
    new Vec3(dirtpitCenter.x - 4, 63, dirtpitCenter.z - 4),
    new Vec3(dirtpitCenter.x + 4, 63, dirtpitCenter.z + 4),
    'dirt'
  );

  // Signs at spawn
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', {
    signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}`,
  });
  world.setBlock(new Vec3(3, 64, 0), 'oak_sign', {
    signText: `[FARM]\nX: ${farmCenter.x}\nY: ${farmCenter.y}\nZ: ${farmCenter.z}`,
  });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', {
    signText: `[DIRTPIT]\nX: ${dirtpitCenter.x}\nY: ${dirtpitCenter.y}\nZ: ${dirtpitCenter.z}`,
  });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 2),
    botInventory: [{ name: 'iron_shovel', count: 1 }], // Shovel but NO dirt!
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  📋 Dirt Gathering Test:');
  console.log(`     - Farm at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z}) with ${holePositions.length} holes`);
  console.log(`     - Dirtpit at (${dirtpitCenter.x}, ${dirtpitCenter.y}, ${dirtpitCenter.z})`);
  console.log(`     - Bot has shovel but NO dirt - must gather first`);

  // Track progress
  let hasStudiedSigns = false;
  let hasDetectedIssues = false;
  let hasGatheredDirt = false;
  let lastDirtCount = 0;

  // Wait for the bot to fill the holes (which requires gathering dirt first)
  await test.waitUntil(
    () => {
      const bb = (role as any).blackboard;
      if (!bb) return false;

      // Track phase transitions
      if (!hasStudiedSigns && bb.hasStudiedSigns) {
        hasStudiedSigns = true;
        console.log('  ✓ Phase 1: Studied signs');
      }

      if (!hasDetectedIssues && bb.farmMaintenanceNeeded) {
        hasDetectedIssues = true;
        console.log('  ✓ Phase 2: Detected farm needs maintenance');
      }

      const dirtCount = bb.dirtCount || 0;
      if (!hasGatheredDirt && dirtCount > 0) {
        hasGatheredDirt = true;
        console.log(`  ✓ Phase 3: Started gathering dirt (now has ${dirtCount})`);
      }

      if (dirtCount > lastDirtCount) {
        console.log(`  [progress] Dirt count: ${dirtCount}`);
        lastDirtCount = dirtCount;
      }

      // Check if holes are filled
      const holesRemaining = holePositions.filter(pos => {
        const block = test.blockAt(pos);
        return block === 'air';
      });

      if (holesRemaining.length < holePositions.length) {
        console.log(`  [progress] Filled ${holePositions.length - holesRemaining.length}/${holePositions.length} holes`);
      }

      return holesRemaining.length === 0;
    },
    {
      timeout: 120000,
      interval: 3000,
      message: 'Bot should gather dirt and fill all farm holes',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const bb = (role as any).blackboard;

  // 1. All phases should have completed
  test.assert(hasStudiedSigns, 'Bot should have studied spawn signs');
  test.assert(hasGatheredDirt, 'Bot should have gathered dirt from dirtpit');

  // 2. All holes should be filled
  for (const pos of holePositions) {
    const block = test.blockAt(pos);
    test.assert(
      block === 'dirt' || block === 'grass_block',
      `Hole at (${pos.x}, ${pos.z}) should be filled (was ${block})`
    );
  }

  console.log(`  ✓ All ${holePositions.length} holes filled`);
  console.log(`  ✓ Final dirt count: ${bb.dirtCount || 0}`);

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
