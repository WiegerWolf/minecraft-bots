#!/usr/bin/env bun
/**
 * Farmer Movement Simulation Tests
 *
 * SPECIFICATION: Farmer Movement & Pathfinding
 *
 * Tests for dynamic movement behavior:
 * - Parkour (jumping) enabled when away from farmland
 * - Parkour disabled when near farmland to prevent trampling
 * - Bot can navigate obstacle courses with both parkour and farm sections
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Parkour + Farm obstacle course (dynamic movement switching)
// ═══════════════════════════════════════════════════════════════════════════

async function testParkourAndFarmObstacleCourse() {
  const test = new SimulationTest('Parkour + Farm obstacle course');

  const world = new MockWorld();

  // Build at y=64, 1-block wide parkour paths, square farm in the middle
  const floorY = 64;

  // Helper to build a 1-block wide platform (z=0)
  const buildPath = (x1: number, x2: number, blockType: string) => {
    for (let x = x1; x <= x2; x++) {
      world.setBlock(new Vec3(x, floorY, 0), blockType);
    }
  };

  // ── Section 1: Starting platform ──
  buildPath(-2, 2, 'stone');
  world.setBlock(new Vec3(0, floorY + 1, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 65\nZ: 0' });

  // ── Section 2: First parkour gap (2-block gap, requires jump) ──
  // Gap from x=3 to x=4
  buildPath(5, 7, 'stone');

  // ── Section 3: Second parkour gap ──
  // Gap from x=8 to x=9
  buildPath(10, 12, 'stone');

  // ── Section 4: Entry platform to farm ──
  // Gap from x=13 to x=14
  buildPath(15, 19, 'stone');

  // ── Section 5: Square farm (9x9 with water center) ──
  // Farm spans x=20-28, z=-4 to z=4 (centered on z=0)
  // Wider entry side for easier landing from parkour
  const farmlandPositions: Vec3[] = [];
  const farmX1 = 20, farmX2 = 28;
  const farmZ1 = -4, farmZ2 = 4;
  const waterPos = new Vec3(24, floorY, 0); // Center

  for (let x = farmX1; x <= farmX2; x++) {
    for (let z = farmZ1; z <= farmZ2; z++) {
      if (x === waterPos.x && z === waterPos.z) {
        // Water source in center - block below to prevent flow
        world.setBlock(new Vec3(x, floorY - 1, z), 'stone');
        world.setBlock(new Vec3(x, floorY, z), 'water');
      } else {
        world.setBlock(new Vec3(x, floorY, z), 'farmland');
        farmlandPositions.push(new Vec3(x, floorY, z));
      }
    }
  }

  // ── Section 6: Exit platform from farm ──
  buildPath(29, 33, 'stone');

  // ── Section 7: Third parkour gap (after farm - proves bot can jump again) ──
  // Gap from x=34 to x=35
  buildPath(36, 38, 'stone');

  await test.setup(world, {
    botPosition: new Vec3(0, floorY + 1, 0),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
    skipDefaultGround: true, // Void world - only our platforms exist
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, floorY + 1, 0) });

  // Spawn wheat (not seeds!) along the path to guide the bot
  // Using wheat avoids planting behavior - bot just collects
  // Platform 1 (x=5-7)
  await test.rcon('summon item 6 65 0 {Item:{id:"minecraft:wheat",count:2}}');
  await test.wait(500);
  // Platform 2 (x=10-12)
  await test.rcon('summon item 11 65 0 {Item:{id:"minecraft:wheat",count:2}}');
  await test.wait(500);
  // Entry platform (x=15-19)
  await test.rcon('summon item 17 65 0 {Item:{id:"minecraft:wheat",count:2}}');
  await test.wait(500);
  // On farm (x=20-28, avoiding water at x=24)
  await test.rcon('summon item 22 65 0 {Item:{id:"minecraft:wheat",count:2}}');
  await test.wait(500);
  await test.rcon('summon item 26 65 0 {Item:{id:"minecraft:wheat",count:2}}');
  await test.wait(500);
  // Exit platform (x=29-33)
  await test.rcon('summon item 31 65 0 {Item:{id:"minecraft:wheat",count:2}}');
  await test.wait(500);
  // Final platform (x=36-38)
  await test.rcon('summon item 37 65 0 {Item:{id:"minecraft:wheat",count:5}}');

  // Wait for bot to collect most wheat (proves it navigated the whole course)
  // Total spawned: 17 wheat, expect at least 15
  await test.waitForInventory('wheat', 15, {
    timeout: 120000,
    message: 'Bot should navigate parkour + farm to collect wheat',
  });

  // ── Verify farmland wasn't trampled ──
  let farmlandIntact = 0;
  let farmlandTrampled = 0;
  for (const pos of farmlandPositions) {
    const block = test.blockAt(pos);
    if (block === 'farmland') {
      farmlandIntact++;
    } else {
      farmlandTrampled++;
    }
  }

  // Strict check: farmland should be mostly intact
  test.assertGreater(
    farmlandIntact,
    farmlandPositions.length * 0.9, // 90%+ should be intact
    `Farmland should remain intact (${farmlandIntact}/${farmlandPositions.length} intact, ${farmlandTrampled} trampled)`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'obstacle': testParkourAndFarmObstacleCourse,
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
