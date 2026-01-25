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
    clearRadius: 30,
  });

  // === BUILD WORLD VIA RCON ===
  // Foundation and ground layer
  await test.rcon('fill 4 62 4 20 62 20 minecraft:stone');
  await test.rcon('fill 4 63 4 20 63 20 minecraft:grass_block');

  // Water source at farm center
  await test.rcon(`setblock ${farmCenter.x} ${farmCenter.y} ${farmCenter.z} minecraft:water`);

  // Raised terrain that needs flattening (dirt at y=64)
  await test.rcon('setblock 10 64 10 minecraft:dirt');
  await test.rcon('setblock 10 64 11 minecraft:dirt');
  await test.rcon('setblock 10 64 12 minecraft:dirt');
  await test.rcon('setblock 11 64 10 minecraft:dirt');
  await test.rcon('setblock 14 64 14 minecraft:dirt');
  await test.rcon('setblock 14 64 13 minecraft:dirt');
  await test.rcon('setblock 13 64 14 minecraft:dirt');

  // Signs are placed via MockWorld buildWorldFromMockWorld (uses placeSign with proper text)

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

  // === LOCATIONS ===
  const villageCenter = new Vec3(0, 64, 0);
  const farmCenter = new Vec3(15, 63, 15);
  // Dirtpit: 50+ from village, 30+ from farm
  const dirtpitCenter = new Vec3(60, 63, 60);

  // === SIGNS at spawn (placed via MockWorld for sign reading) ===
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', {
    signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}`,
  });
  world.setBlock(new Vec3(3, 64, 0), 'oak_sign', {
    signText: `[FARM]\nX: ${farmCenter.x}\nY: ${farmCenter.y}\nZ: ${farmCenter.z}`,
  });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', {
    signText: `[DIRTPIT]\nX: ${dirtpitCenter.x}\nY: ${dirtpitCenter.y}\nZ: ${dirtpitCenter.z}`,
  });

  // === HOLES in the farm surface (y=63) - mark in MockWorld ===
  const holePositions = [
    new Vec3(13, 63, 15),
    new Vec3(17, 63, 15),
    new Vec3(15, 63, 13),
  ];
  for (const pos of holePositions) {
    world.setBlock(pos, 'air');
  }

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 2),
    botInventory: [{ name: 'iron_shovel', count: 1 }], // Shovel but NO dirt!
    clearRadius: 80,
  });

  // === CUSTOM WORLD via RCON (6 fill commands) ===
  // Structure: bedrock(y=58), dirt(y=59-62), grass(y=63)
  await test.rcon('fill -80 58 -80 80 58 80 minecraft:bedrock');
  await test.rcon('fill -80 59 -80 80 59 80 minecraft:dirt');
  await test.rcon('fill -80 60 -80 80 60 80 minecraft:dirt');
  await test.rcon('fill -80 61 -80 80 61 80 minecraft:dirt');
  await test.rcon('fill -80 62 -80 80 62 80 minecraft:dirt');
  await test.rcon('fill -80 63 -80 80 63 80 minecraft:grass_block');

  // === FARM: water source at center ===
  await test.rcon(`setblock ${farmCenter.x} ${farmCenter.y} ${farmCenter.z} minecraft:water`);

  // === HOLES in the farm surface ===
  for (const pos of holePositions) {
    await test.rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`);
  }

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  📋 Dirt Gathering Test (Deep World):');
  console.log(`     - World: bedrock(y=58), dirt(y=59-62), grass(y=63)`);
  console.log(`     - Dirtpit at (${dirtpitCenter.x}, ${dirtpitCenter.y}, ${dirtpitCenter.z})`);
  console.log(`     - Farm at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z}) with ${holePositions.length} holes`);
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

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Establishes dirtpit following distance rules
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Landscaper Dirtpit Establishment
//
// When no dirtpit is known, the landscaper must establish one that:
// - Is 50+ blocks from village center
// - Is 30+ blocks from known farms
// - Is 20+ blocks from known forests
// - Is in an area with good dirt density

async function testEstablishesDirtpit() {
  const test = new SimulationTest('Establishes dirtpit following distance rules');

  const world = new MockWorld();

  // === LOCATIONS ===
  const villageCenter = new Vec3(0, 64, 0);
  const farmCenter = new Vec3(15, 63, 15);
  // Add a forest location to test forest avoidance
  const forestCenter = new Vec3(-30, 64, 10);

  // === SIGNS at spawn - NO DIRTPIT SIGN (bot must establish one) ===
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', {
    signText: `[VILLAGE]\nX: ${villageCenter.x}\nY: ${villageCenter.y}\nZ: ${villageCenter.z}`,
  });
  world.setBlock(new Vec3(3, 64, 0), 'oak_sign', {
    signText: `[FARM]\nX: ${farmCenter.x}\nY: ${farmCenter.y}\nZ: ${farmCenter.z}`,
  });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', {
    signText: `[FOREST]\nX: ${forestCenter.x}\nY: ${forestCenter.y}\nZ: ${forestCenter.z}`,
  });

  // === HOLES in the farm surface (bot needs dirt to fill these) ===
  const holePositions = [
    new Vec3(13, 63, 15),
    new Vec3(17, 63, 15),
  ];
  for (const pos of holePositions) {
    world.setBlock(pos, 'air');
  }

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 2),
    botInventory: [{ name: 'iron_shovel', count: 1 }],
    clearRadius: 80,
  });

  // Build world layers via RCON (after setup)
  await test.rcon('fill -80 58 -80 80 58 80 minecraft:bedrock');
  await test.rcon('fill -80 59 -80 80 59 80 minecraft:dirt');
  await test.rcon('fill -80 60 -80 80 60 80 minecraft:dirt');
  await test.rcon('fill -80 61 -80 80 61 80 minecraft:dirt');
  await test.rcon('fill -80 62 -80 80 62 80 minecraft:dirt');
  await test.rcon('fill -80 63 -80 80 63 80 minecraft:grass_block');

  // === FARM: water source at center ===
  await test.rcon(`setblock ${farmCenter.x} ${farmCenter.y} ${farmCenter.z} minecraft:water`);

  // === HOLES in the farm surface ===
  for (const pos of holePositions) {
    await test.rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`);
  }

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  📋 Dirtpit Establishment Test:');
  console.log(`     - Village at (${villageCenter.x}, ${villageCenter.y}, ${villageCenter.z})`);
  console.log(`     - Farm at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z})`);
  console.log(`     - Forest at (${forestCenter.x}, ${forestCenter.y}, ${forestCenter.z})`);
  console.log(`     - NO dirtpit sign - bot must establish one`);
  console.log(`     - Rules: 50+ from village, 30+ from farm, 20+ from forest`);

  // Distance rules (must match EstablishDirtpit.ts)
  const MIN_DISTANCE_FROM_VILLAGE = 50;
  const MIN_DISTANCE_FROM_FARMS = 30;
  const MIN_DISTANCE_FROM_FORESTS = 20;

  // Wait for bot to establish a dirtpit
  await test.waitUntil(
    () => {
      const bb = (role as any).blackboard;
      return bb?.dirtpit !== null && bb?.dirtpit !== undefined;
    },
    {
      timeout: 90000,
      interval: 2000,
      message: 'Bot should establish a dirtpit location',
    }
  );

  const bb = (role as any).blackboard;
  const dirtpit = bb.dirtpit as Vec3;

  console.log(`  ✓ Dirtpit established at (${dirtpit.x}, ${dirtpit.y}, ${dirtpit.z})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS - Verify dirtpit follows all distance rules
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Distance from village center (must be 50+)
  const distFromVillage = dirtpit.distanceTo(villageCenter);
  console.log(`     - Distance from village: ${distFromVillage.toFixed(1)} blocks (min: ${MIN_DISTANCE_FROM_VILLAGE})`);
  test.assert(
    distFromVillage >= MIN_DISTANCE_FROM_VILLAGE,
    `Dirtpit must be ${MIN_DISTANCE_FROM_VILLAGE}+ blocks from village (was ${distFromVillage.toFixed(1)})`
  );

  // 2. Distance from farm (must be 30+)
  const distFromFarm = dirtpit.distanceTo(farmCenter);
  console.log(`     - Distance from farm: ${distFromFarm.toFixed(1)} blocks (min: ${MIN_DISTANCE_FROM_FARMS})`);
  test.assert(
    distFromFarm >= MIN_DISTANCE_FROM_FARMS,
    `Dirtpit must be ${MIN_DISTANCE_FROM_FARMS}+ blocks from farm (was ${distFromFarm.toFixed(1)})`
  );

  // 3. Distance from forest (must be 20+)
  const distFromForest = dirtpit.distanceTo(forestCenter);
  console.log(`     - Distance from forest: ${distFromForest.toFixed(1)} blocks (min: ${MIN_DISTANCE_FROM_FORESTS})`);
  test.assert(
    distFromForest >= MIN_DISTANCE_FROM_FORESTS,
    `Dirtpit must be ${MIN_DISTANCE_FROM_FORESTS}+ blocks from forest (was ${distFromForest.toFixed(1)})`
  );

  // 4. Verify bot can gather dirt from the established dirtpit
  // Wait for dirt gathering to start (proves dirtpit is usable)
  await test.waitUntil(
    () => {
      const currentBb = (role as any).blackboard;
      return (currentBb?.dirtCount || 0) > 0;
    },
    {
      timeout: 60000,
      interval: 2000,
      message: 'Bot should gather dirt from the established dirtpit',
    }
  );

  const finalDirtCount = bb.dirtCount || 0;
  console.log(`  ✓ Gathered ${finalDirtCount} dirt from established dirtpit`);

  test.assert(finalDirtCount > 0, 'Bot should have gathered some dirt');

  const botPos = test.botPosition();
  if (botPos) {
    console.log(`  📍 Bot final position: (${Math.floor(botPos.x)}, ${Math.floor(botPos.y)}, ${Math.floor(botPos.z)})`);
  }

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Reads unknown signs discovered while working
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Curious Bot Behavior
//
// When the landscaper spots a sign it hasn't read, it should investigate
// and read it. This helps discover new farms or useful information.
//
// Test setup:
// - Spawn area has only VILLAGE sign (bot studies this first)
// - A known farm exists at (30, 63, 30) - bot will travel there to check it
// - An UNKNOWN sign is placed at (28, 64, 28) - near the farm, NOT at spawn
// - Bot should discover this sign while visiting the farm and read it
// - The unknown sign points to a SECOND farm at (50, 63, 50)

async function testReadsUnknownSigns() {
  const test = new SimulationTest('Reads unknown signs discovered while working');

  const world = new MockWorld();

  // Large ground area
  world.fill(new Vec3(-20, 63, -20), new Vec3(60, 63, 60), 'grass_block');

  // === SPAWN AREA SIGNS (only VILLAGE + first FARM) ===
  // These are the signs the bot studies on startup
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 30\nY: 63\nZ: 30' });

  // === FIRST FARM at (30, 63, 30) ===
  // Bot will travel here after studying signs (CheckKnownFarms goal)
  const firstFarmCenter = new Vec3(30, 63, 30);
  world.fill(new Vec3(26, 62, 26), new Vec3(34, 62, 34), 'stone');
  world.fill(new Vec3(26, 63, 26), new Vec3(34, 63, 34), 'grass_block');
  world.setBlock(firstFarmCenter, 'water');

  // === UNKNOWN SIGN placed NEAR the first farm (NOT at spawn) ===
  // This sign is 30+ blocks from spawn, so it won't be found during StudySpawnSigns
  // But the bot will encounter it when visiting the first farm
  const unknownSignPos = new Vec3(28, 64, 28);
  world.setBlock(unknownSignPos, 'oak_sign', { signText: '[FARM]\nX: 50\nY: 63\nZ: 50' });

  // === SECOND FARM at (50, 63, 50) - referenced by the unknown sign ===
  const secondFarmCenter = new Vec3(50, 63, 50);
  world.fill(new Vec3(46, 62, 46), new Vec3(54, 62, 54), 'stone');
  world.fill(new Vec3(46, 63, 46), new Vec3(54, 63, 54), 'grass_block');
  world.setBlock(secondFarmCenter, 'water');

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 32 }, // Has dirt to fill holes
    ],
    clearRadius: 70,
  });

  // Build farms via RCON
  await test.rcon('fill 26 62 26 34 62 34 minecraft:stone');
  await test.rcon('fill 26 63 26 34 63 34 minecraft:grass_block');
  await test.rcon(`setblock ${firstFarmCenter.x} ${firstFarmCenter.y} ${firstFarmCenter.z} minecraft:water`);

  // === CREATE HOLES IN FIRST FARM ===
  // These holes will make the bot stay at the farm longer to fix them,
  // giving it time to notice the unknown sign nearby
  const holePositions = [
    new Vec3(28, 63, 30), // Near the unknown sign
    new Vec3(32, 63, 30),
    new Vec3(30, 63, 28), // Very close to unknown sign
    new Vec3(30, 63, 32),
  ];
  for (const pos of holePositions) {
    await test.rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`);
  }

  await test.rcon('fill 46 62 46 54 62 54 minecraft:stone');
  await test.rcon('fill 46 63 46 54 63 54 minecraft:grass_block');
  await test.rcon(`setblock ${secondFarmCenter.x} ${secondFarmCenter.y} ${secondFarmCenter.z} minecraft:water`);

  // Unknown sign is already placed via MockWorld (synced during setup)
  // No need to place via RCON - MockWorld signs are synced before bot connects

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  console.log('  📋 Unknown Sign Discovery Test:');
  console.log('     - Spawn signs: VILLAGE(0,64,0), FARM(30,63,30)');
  console.log(`     - Unknown sign at (${unknownSignPos.x}, ${unknownSignPos.y}, ${unknownSignPos.z}) pointing to farm at (50,63,50)`);
  console.log('     - First farm has 4 holes to fill (keeps bot near the sign)');
  console.log('     - Bot should: study signs → go fix farm → discover unknown sign → read it');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  // Track progress
  let studiedInitialSigns = false;
  let visitedFirstFarm = false;
  let discoveredSecondFarm = false;
  let initialFarmCount = 0;

  await test.waitUntil(
    () => {
      const bb = (role as any).blackboard;
      if (!bb) return false;

      // Phase 1: Study initial signs
      if (!studiedInitialSigns && bb.hasStudiedSigns) {
        studiedInitialSigns = true;
        initialFarmCount = bb.knownFarms?.length ?? 0;
        console.log(`  ✓ Phase 1: Studied spawn signs (knows ${initialFarmCount} farm(s))`);
      }

      // Phase 2: Visit first farm (bot should move toward it)
      if (studiedInitialSigns && !visitedFirstFarm) {
        const distToFirstFarm = test.botDistanceTo(firstFarmCenter);
        if (distToFirstFarm < 15) {
          visitedFirstFarm = true;
          console.log(`  ✓ Phase 2: Visited first farm (distance: ${distToFirstFarm.toFixed(1)})`);
        }
      }

      // Phase 3: Discover the second farm from the unknown sign
      // The unknown sign at (28,64,28) points to farm at (50,63,50)
      if (visitedFirstFarm && !discoveredSecondFarm) {
        const knownFarms = bb.knownFarms ?? [];
        // Check if the bot learned about the second farm (50, 63, 50)
        if (knownFarms.some((f: any) => f.x === 50 && f.z === 50)) {
          discoveredSecondFarm = true;
          console.log(`  ✓ Phase 3: Read unknown sign - now knows ${knownFarms.length} farms`);
        }
      }

      return discoveredSecondFarm;
    },
    {
      timeout: 120000,
      interval: 3000,
      message: 'Bot should discover and read unknown sign near the first farm',
    }
  );

  // Final assertions
  test.assert(studiedInitialSigns, 'Bot should have studied initial spawn signs');
  test.assert(visitedFirstFarm, 'Bot should have visited the first farm');
  test.assert(discoveredSecondFarm, 'Bot should have read unknown sign and learned about second farm');

  // Verify bot knows about both farms now
  const bb = (role as any).blackboard;
  const finalFarmCount = bb.knownFarms?.length ?? 0;
  console.log(`  📊 Final state: knows ${finalFarmCount} farms (started with ${initialFarmCount})`);

  test.assertGreater(
    finalFarmCount,
    initialFarmCount,
    `Bot should have learned about more farms (was ${initialFarmCount}, now ${finalFarmCount})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Complete maintenance cycle (detect → gather dirt → fix)
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Complete Maintenance Workflow
//
// Tests the full flow: bot detects farm issues, gathers dirt if needed,
// and fixes all issues in the farm area.

async function testCompleteMaintenanceCycle() {
  const test = new SimulationTest('Complete maintenance cycle');

  const world = new MockWorld();

  // Locations
  const villageCenter = new Vec3(0, 64, 0);
  const farmCenter = new Vec3(15, 63, 15);
  const dirtpitCenter = new Vec3(60, 63, 60);

  // Ground
  world.fill(new Vec3(-10, 62, -10), new Vec3(70, 62, 70), 'stone');
  world.fill(new Vec3(-10, 63, -10), new Vec3(70, 63, 70), 'grass_block');

  // Farm with water source
  world.setBlock(farmCenter, 'water');

  // Multiple issues in the farm:
  // 1. Holes (missing surface blocks)
  const holePositions = [
    new Vec3(13, 63, 15),
    new Vec3(17, 63, 15),
    new Vec3(15, 63, 13),
    new Vec3(15, 63, 17),
  ];
  for (const pos of holePositions) {
    world.setBlock(pos, 'air');
  }

  // 2. Raised dirt (obstructions)
  const obstructionPositions = [
    new Vec3(14, 64, 14),
    new Vec3(16, 64, 16),
  ];
  for (const pos of obstructionPositions) {
    world.setBlock(pos, 'dirt');
  }

  // Signs
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
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      // Start with NO dirt - must gather from dirtpit
    ],
    clearRadius: 80,
  });

  // Build world via RCON
  await test.rcon('fill -10 62 -10 70 62 70 minecraft:stone');
  await test.rcon('fill -10 63 -10 70 63 70 minecraft:grass_block');
  await test.rcon(`setblock ${farmCenter.x} ${farmCenter.y} ${farmCenter.z} minecraft:water`);

  // Create holes
  for (const pos of holePositions) {
    await test.rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:air`);
  }

  // Create obstructions
  for (const pos of obstructionPositions) {
    await test.rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:dirt`);
  }

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  📋 Complete Maintenance Cycle Test:');
  console.log(`     - Farm at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z})`);
  console.log(`     - ${holePositions.length} holes to fill`);
  console.log(`     - ${obstructionPositions.length} obstructions to clear`);
  console.log(`     - Bot starts with NO dirt - must gather first`);

  // Wait for all issues to be resolved
  await test.waitUntil(
    () => {
      // Check holes filled
      const holesRemaining = holePositions.filter(pos => {
        const block = test.blockAt(pos);
        return block === 'air';
      });

      // Check obstructions cleared
      const obstructionsRemaining = obstructionPositions.filter(pos => {
        const block = test.blockAt(pos);
        return block !== 'air';
      });

      if (holesRemaining.length > 0 || obstructionsRemaining.length > 0) {
        console.log(`  [check] ${holesRemaining.length} holes, ${obstructionsRemaining.length} obstructions remaining`);
      }

      return holesRemaining.length === 0 && obstructionsRemaining.length === 0;
    },
    {
      timeout: 180000,
      interval: 5000,
      message: 'Bot should fix all farm issues (holes and obstructions)',
    }
  );

  // Final verification
  for (const pos of holePositions) {
    const block = test.blockAt(pos);
    test.assert(
      block === 'dirt' || block === 'grass_block',
      `Hole at (${pos.x}, ${pos.z}) should be filled (was ${block})`
    );
  }

  for (const pos of obstructionPositions) {
    const block = test.blockAt(pos);
    test.assert(
      block === 'air',
      `Obstruction at (${pos.x}, ${pos.z}) should be cleared (was ${block})`
    );
  }

  console.log('  ✓ All farm issues resolved');

  role.stop(test.bot);
  return test.cleanup();
}

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'flatten': testFlattensTerrain,
  'holes': testFillsHoles,
  'dirt': testGathersDirt,
  'establish-dirtpit': testEstablishesDirtpit,
  'unknown-signs': testReadsUnknownSigns,
  'full-cycle': testCompleteMaintenanceCycle,
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
