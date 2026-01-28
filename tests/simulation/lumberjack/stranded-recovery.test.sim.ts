#!/usr/bin/env bun
/**
 * Lumberjack Stranded Recovery Simulation Tests
 *
 * SPECIFICATION: Stranded on Tree Recovery
 *
 * When a lumberjack chops a tall tree and clears leaves while standing
 * on top, they can end up stranded on a single log block 5+ blocks
 * in the air. The pathfinder cannot find a way down.
 *
 * The bot must detect this situation and recover by:
 * 1. Recognizing it's elevated with no adjacent blocks to walk to
 * 2. Safely descending (placing blocks to pillar down, or controlled fall)
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Recovers when stranded on top of a log pillar
// ═══════════════════════════════════════════════════════════════════════════

async function testRecoversFromStrandedOnTree() {
  const test = new SimulationTest('Recovers when stranded on top of tree');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Signs for village (bot needs context to start working)
  world.setBlock(new Vec3(5, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 0' });

  // A tree to give the bot something to do after recovery
  world.setBlock(new Vec3(10, 64, 10), 'oak_log');
  world.setBlock(new Vec3(10, 65, 10), 'oak_log');
  world.setBlock(new Vec3(10, 66, 10), 'oak_log');
  world.setBlock(new Vec3(10, 67, 10), 'oak_log');
  // Add leaves to make it a valid tree
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.setBlock(new Vec3(10 + dx, 68, 10 + dz), 'oak_leaves');
      world.setBlock(new Vec3(10 + dx, 69, 10 + dz), 'oak_leaves');
    }
  }

  // Spawn bot on ground first
  await test.setup(world, {
    botPosition: new Vec3(5, 64, 0),
    botInventory: [
      { name: 'iron_axe', count: 1 },
      { name: 'cobblestone', count: 10 }, // For potential block placement escape
    ],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  // Create the pillar via RCON (after world is loaded)
  // This ensures the blocks exist when we teleport the bot
  const pillarHeight = 6;
  const pillarX = 0;
  const pillarZ = 0;
  for (let y = 0; y < pillarHeight; y++) {
    await test.rcon(`setblock ${pillarX} ${64 + y} ${pillarZ} minecraft:oak_log`);
  }
  await test.wait(500, 'Pillar blocks placed');

  // Teleport bot to top of pillar (stranded position)
  // Bot feet at Y=70, standing on log at Y=69
  const strandedY = 64 + pillarHeight; // Y=70 (feet), standing on block at Y=69
  await test.rcon(`tp SimBot ${pillarX} ${strandedY} ${pillarZ}`);
  await test.wait(500, 'Bot teleported to pillar top');

  // Verify bot is actually stranded
  const posAfterTp = test.botPosition();
  console.log(`  Bot position after teleport: ${posAfterTp?.toString()}`);
  test.assert(
    posAfterTp !== null && posAfterTp.y >= strandedY - 0.5,
    `Bot should be on top of pillar (Y=${posAfterTp?.y?.toFixed(1) || 'null'}, expected ~${strandedY})`
  );

  // Record starting height before starting role
  const startY = test.botPosition()?.y || strandedY;

  // Now start the role - bot should detect stranded state and recover
  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: new Vec3(5, 64, 0) });

  // Wait for bot to descend (Y should decrease significantly)
  // The recovery mechanism should kick in after planning failures
  await test.waitUntil(
    () => {
      const pos = test.botPosition();
      if (!pos) return false;
      // Bot should be near ground level (Y ~64) or at least significantly lower
      return pos.y < startY - 3;
    },
    { timeout: 90000, message: 'Bot should descend from stranded position' }
  );

  // Verify bot is now at ground level
  const finalPos = test.botPosition();
  test.assert(
    finalPos !== null && finalPos.y < 68,
    `Bot should be near ground level (Y=${finalPos?.y?.toFixed(1) || 'null'})`
  );

  // Verify bot can now move and function (try to reach the tree)
  await test.waitUntil(
    () => {
      const pos = test.botPosition();
      if (!pos) return false;
      // Bot should have moved horizontally after descending
      return pos.distanceTo(new Vec3(pillarX, pos.y, pillarZ)) > 3;
    },
    { timeout: 30000, message: 'Bot should be able to move after recovery' }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Recovers when stranded at moderate height (4 blocks)
// ═══════════════════════════════════════════════════════════════════════════

async function testRecoversFromModerateHeight() {
  const test = new SimulationTest('Recovers from moderate height (4 blocks)');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  world.setBlock(new Vec3(5, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 5\nY: 64\nZ: 0' });

  // Spawn on ground
  await test.setup(world, {
    botPosition: new Vec3(5, 64, 0),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  // Create shorter pillar - 4 blocks (safe fall damage)
  const pillarHeight = 4;
  const pillarX = 0;
  const pillarZ = 0;
  for (let y = 0; y < pillarHeight; y++) {
    await test.rcon(`setblock ${pillarX} ${64 + y} ${pillarZ} minecraft:oak_log`);
  }
  await test.wait(500, 'Pillar blocks placed');

  // Teleport to top
  const strandedY = 64 + pillarHeight; // Y=68
  await test.rcon(`tp SimBot ${pillarX} ${strandedY} ${pillarZ}`);
  await test.wait(500, 'Bot teleported to pillar top');

  const startY = test.botPosition()?.y || strandedY;

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: new Vec3(5, 64, 0) });

  // Wait for descent
  await test.waitUntil(
    () => {
      const pos = test.botPosition();
      return pos !== null && pos.y < startY - 2;
    },
    { timeout: 60000, message: 'Bot should descend from moderate height' }
  );

  // Verify bot survived (not dead)
  test.assert(
    test.botHealth() > 0,
    `Bot should survive the descent (health=${test.botHealth()})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Does NOT trigger recovery when on normal ground
// ═══════════════════════════════════════════════════════════════════════════

async function testNoFalsePositiveOnGround() {
  const test = new SimulationTest('No false positive on normal ground');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0), // Normal ground level
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPLumberjackRole();
  role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait a bit - bot should NOT attempt any recovery actions
  await test.wait(10000, 'Verifying no false positive recovery attempts');

  // Bot should still be near ground level (not having fallen or done weird things)
  const pos = test.botPosition();
  test.assert(
    pos !== null && pos.y >= 63 && pos.y < 66,
    `Bot should remain at ground level (Y=${pos?.y?.toFixed(1) || 'null'})`
  );

  // Bot should be healthy
  test.assert(
    test.botHealth() >= 20,
    `Bot should be at full health (health=${test.botHealth()})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'stranded-tall': testRecoversFromStrandedOnTree,
  'stranded-moderate': testRecoversFromModerateHeight,
  'no-false-positive': testNoFalsePositiveOnGround,
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
