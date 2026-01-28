#!/usr/bin/env bun
/**
 * Landscaper Terraforming Simulation Tests
 *
 * SPECIFICATION: Landscaper Terraforming Actions
 *
 * Tests the landscaper's ability to handle complex terraforming scenarios:
 * - River shore: Fill surrounding water while preserving center water source
 * - Sandy areas: Replace sand with dirt to create farmable land
 * - Mixed terrain: Handle combinations of water, sand, and other non-farmable blocks
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld } from '../../mocks/MockWorld';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Fills river water around farm center
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: River Shore Farm Creation
//
// When a farm water source is at the edge of a river, the bot must:
// 1. Identify the center water block as the farm center (preserve it)
// 2. Fill all surrounding water blocks with dirt
// 3. Leave only the center water block for irrigation
//
// Scenario:
// - River runs through the area (multiple water blocks)
// - Farm sign points to one water block that becomes the center
// - Bot fills surrounding water, creating farmable land around center

async function testFillsRiverWaterAroundFarmCenter() {
  const test = new SimulationTest('Fills river water around farm center');

  const world = new MockWorld();

  // Farm center - this water block becomes the irrigation source
  const farmCenter = new Vec3(15, 63, 15);

  // Build ground with a river running through it
  // The river is 3 blocks wide, running along the Z axis
  world.fill(new Vec3(5, 62, 5), new Vec3(25, 62, 25), 'stone'); // Foundation
  world.fill(new Vec3(5, 63, 5), new Vec3(25, 63, 25), 'grass_block'); // Ground

  // Create a river (3 blocks wide) running through the farm area
  // River runs from z=10 to z=20 at x=14,15,16
  for (let z = 10; z <= 20; z++) {
    world.setBlock(new Vec3(14, 63, z), 'water');
    world.setBlock(new Vec3(15, 63, z), 'water'); // Farm center is part of the river
    world.setBlock(new Vec3(16, 63, z), 'water');
  }

  // Signs
  world.setBlock(new Vec3(7, 64, 7), 'oak_sign', { signText: '[VILLAGE]\nX: 7\nY: 64\nZ: 7' });
  world.setBlock(new Vec3(8, 64, 7), 'oak_sign', { signText: `[FARM]\nX: ${farmCenter.x}\nY: ${farmCenter.y}\nZ: ${farmCenter.z}` });
  // Dirtpit for gathering dirt to fill the river
  world.setBlock(new Vec3(9, 64, 7), 'oak_sign', { signText: '[DIRTPIT]\nX: 40\nY: 63\nZ: 40' });

  await test.setup(world, {
    botPosition: new Vec3(7, 64, 8),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 64 }, // Start with dirt for filling
    ],
    clearRadius: 50,
  });

  // === BUILD WORLD VIA RCON ===
  await test.rcon('fill 5 62 5 25 62 25 minecraft:stone');
  await test.rcon('fill 5 63 5 25 63 25 minecraft:grass_block');

  // Create the river
  await test.rcon('fill 14 63 10 16 63 20 minecraft:water');

  // Dirtpit area (for gathering more dirt if needed)
  await test.rcon('fill 35 62 35 45 62 45 minecraft:stone');
  await test.rcon('fill 35 63 35 45 63 45 minecraft:dirt');

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  🌊 River Shore Test:');
  console.log(`     - Farm center at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z})`);
  console.log('     - River runs through farm area (3 blocks wide, z=10 to z=20)');
  console.log('     - Bot should fill all river water EXCEPT the center irrigation block');

  // Track water blocks that should be filled (all river water except center)
  const riverWaterPositions: Vec3[] = [];
  for (let z = 10; z <= 20; z++) {
    for (let x = 14; x <= 16; x++) {
      // Skip the farm center - it should remain water
      if (x === farmCenter.x && z === farmCenter.z) continue;

      // Only include water within the 9x9 farm area (radius 4 from center)
      const dx = Math.abs(x - farmCenter.x);
      const dz = Math.abs(z - farmCenter.z);
      if (dx <= 4 && dz <= 4) {
        riverWaterPositions.push(new Vec3(x, 63, z));
      }
    }
  }

  console.log(`     - ${riverWaterPositions.length} water blocks should be filled within farm area`);

  // Wait for the river water to be filled
  await test.waitUntil(
    () => {
      // Check how many water blocks remain (excluding center)
      const waterRemaining = riverWaterPositions.filter(pos => {
        const block = test.blockAt(pos);
        return block === 'water' || block === 'flowing_water';
      });

      // Check center is still water
      const centerBlock = test.blockAt(farmCenter);
      const centerIsWater = centerBlock === 'water' || centerBlock === 'flowing_water';

      if (waterRemaining.length > 0) {
        console.log(`  [check] ${waterRemaining.length} water blocks remaining, center=${centerIsWater ? 'water' : centerBlock}`);
      }

      return waterRemaining.length === 0 && centerIsWater;
    },
    {
      timeout: 120000,
      interval: 3000,
      message: 'Bot should fill all river water except farm center',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Farm center MUST remain water (the irrigation source)
  const centerBlock = test.blockAt(farmCenter);
  test.assert(
    centerBlock === 'water' || centerBlock === 'flowing_water',
    `Farm center must remain water for irrigation (was ${centerBlock})`
  );

  // 2. All surrounding water in farm area should be filled with dirt
  for (const pos of riverWaterPositions) {
    const block = test.blockAt(pos);
    test.assert(
      block === 'dirt' || block === 'grass_block',
      `River water at (${pos.x}, ${pos.z}) should be filled with dirt (was ${block})`
    );
  }

  // 3. Verify the 9x9 farm area has solid ground (except water center)
  let solidCount = 0;
  let totalChecked = 0;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (dx === 0 && dz === 0) continue; // Skip center

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

  console.log('  ✓ River water filled successfully - only center water remains');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Replaces sand with dirt for farm
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Sandy Area Farm Creation
//
// When creating a farm in a sandy area (like a beach or desert):
// 1. Detect sand as non-farmable surface material
// 2. Remove sand blocks
// 3. Replace with dirt for farmable land
//
// Scenario:
// - Beach/desert-like area with sand around a water source
// - Farm sign points to water source
// - Bot replaces sand with dirt to create farmable land

async function testReplacesSandWithDirt() {
  const test = new SimulationTest('Replaces sand with dirt for farm');

  const world = new MockWorld();

  // Farm center - water source in a sandy area
  const farmCenter = new Vec3(15, 63, 15);

  // Build a beach-like area: stone foundation with sand surface
  world.fill(new Vec3(5, 62, 5), new Vec3(25, 62, 25), 'stone'); // Foundation
  world.fill(new Vec3(5, 63, 5), new Vec3(25, 63, 25), 'sand'); // Sandy surface

  // Water source at farm center
  world.setBlock(farmCenter, 'water');

  // Signs
  world.setBlock(new Vec3(7, 64, 7), 'oak_sign', { signText: '[VILLAGE]\nX: 7\nY: 64\nZ: 7' });
  world.setBlock(new Vec3(8, 64, 7), 'oak_sign', { signText: `[FARM]\nX: ${farmCenter.x}\nY: ${farmCenter.y}\nZ: ${farmCenter.z}` });
  // Dirtpit for getting dirt
  world.setBlock(new Vec3(9, 64, 7), 'oak_sign', { signText: '[DIRTPIT]\nX: 40\nY: 63\nZ: 40' });

  await test.setup(world, {
    botPosition: new Vec3(7, 64, 8),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 64 }, // Start with dirt for replacing sand
    ],
    clearRadius: 50,
  });

  // === BUILD WORLD VIA RCON ===
  await test.rcon('fill 5 62 5 25 62 25 minecraft:stone');
  await test.rcon('fill 5 63 5 25 63 25 minecraft:sand');

  // Water source at farm center
  await test.rcon(`setblock ${farmCenter.x} ${farmCenter.y} ${farmCenter.z} minecraft:water`);

  // Dirtpit area with dirt
  await test.rcon('fill 35 62 35 45 62 45 minecraft:stone');
  await test.rcon('fill 35 63 35 45 63 45 minecraft:dirt');

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  🏖️  Sandy Area Test:');
  console.log(`     - Farm center at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z})`);
  console.log('     - Entire farm area is sand (non-farmable)');
  console.log('     - Bot should replace sand with dirt within 9x9 area');

  // Positions that need sand->dirt conversion (within 9x9 farm area)
  const sandPositions: Vec3[] = [];
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (dx === 0 && dz === 0) continue; // Skip center (water)
      sandPositions.push(new Vec3(farmCenter.x + dx, 63, farmCenter.z + dz));
    }
  }

  console.log(`     - ${sandPositions.length} sand blocks should become farmable (dirt/grass)`);

  // Wait for sand to be replaced with dirt
  await test.waitUntil(
    () => {
      // Count how many positions are now farmable (dirt/grass)
      const farmableCount = sandPositions.filter(pos => {
        const block = test.blockAt(pos);
        return block === 'dirt' || block === 'grass_block' || block === 'farmland';
      }).length;

      const sandRemaining = sandPositions.length - farmableCount;

      if (sandRemaining > 0) {
        console.log(`  [check] ${farmableCount}/${sandPositions.length} positions farmable, ${sandRemaining} sand remaining`);
      }

      // Consider done when most positions are farmable (allow some tolerance)
      return farmableCount >= sandPositions.length * 0.9;
    },
    {
      timeout: 180000,
      interval: 5000,
      message: 'Bot should replace sand with dirt in farm area',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Water source at center must be intact
  const centerBlock = test.blockAt(farmCenter);
  test.assert(
    centerBlock === 'water' || centerBlock === 'flowing_water',
    `Water source at farm center should remain intact (was ${centerBlock})`
  );

  // 2. Count farmable positions in the 9x9 area
  let farmableCount = 0;
  let sandCount = 0;
  for (const pos of sandPositions) {
    const block = test.blockAt(pos);
    if (block === 'dirt' || block === 'grass_block' || block === 'farmland') {
      farmableCount++;
    } else if (block === 'sand') {
      sandCount++;
    }
  }

  console.log(`  📊 Final state: ${farmableCount}/${sandPositions.length} farmable, ${sandCount} sand remaining`);

  // At least 90% should be farmable
  const farmablePercent = (farmableCount / sandPositions.length) * 100;
  test.assert(
    farmablePercent >= 90,
    `At least 90% of farm area should be farmable (was ${farmablePercent.toFixed(1)}%)`
  );

  console.log(`  ✓ Sand replaced with dirt - ${farmablePercent.toFixed(1)}% farmable`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Handles mixed terrain (river + sand)
// ═══════════════════════════════════════════════════════════════════════════
//
// SPECIFICATION: Complex Terrain Terraforming
//
// Tests the bot's ability to handle a combination of challenges:
// - River running through the area (water to fill)
// - Sandy shore along the river (sand to replace)
// - Bot must handle both issues to create farmable land
//
// Scenario:
// - River with sandy shores
// - Farm center is a water block at the river's edge
// - Bot fills water AND replaces sand with dirt

async function testHandlesMixedTerrain() {
  const test = new SimulationTest('Handles mixed terrain (river + sand)');

  const world = new MockWorld();

  // Farm center - at the edge of a river with sandy shore
  const farmCenter = new Vec3(15, 63, 15);

  // Build terrain with a river and sandy shores
  world.fill(new Vec3(5, 62, 5), new Vec3(25, 62, 25), 'stone'); // Foundation
  world.fill(new Vec3(5, 63, 5), new Vec3(25, 63, 25), 'grass_block'); // Default grass

  // River (2 blocks wide) running along x=14,15
  for (let z = 5; z <= 25; z++) {
    world.setBlock(new Vec3(14, 63, z), 'water');
    world.setBlock(new Vec3(15, 63, z), 'water'); // Farm center line
  }

  // Sandy shore along the river (x=13 and x=16,17)
  for (let z = 5; z <= 25; z++) {
    world.setBlock(new Vec3(13, 63, z), 'sand');
    world.setBlock(new Vec3(16, 63, z), 'sand');
    world.setBlock(new Vec3(17, 63, z), 'sand');
  }

  // Signs
  world.setBlock(new Vec3(7, 64, 7), 'oak_sign', { signText: '[VILLAGE]\nX: 7\nY: 64\nZ: 7' });
  world.setBlock(new Vec3(8, 64, 7), 'oak_sign', { signText: `[FARM]\nX: ${farmCenter.x}\nY: ${farmCenter.y}\nZ: ${farmCenter.z}` });
  world.setBlock(new Vec3(9, 64, 7), 'oak_sign', { signText: '[DIRTPIT]\nX: 40\nY: 63\nZ: 40' });

  await test.setup(world, {
    botPosition: new Vec3(7, 64, 8),
    botInventory: [
      { name: 'iron_shovel', count: 1 },
      { name: 'iron_pickaxe', count: 1 },
      { name: 'dirt', count: 64 },
    ],
    clearRadius: 50,
  });

  // === BUILD WORLD VIA RCON ===
  await test.rcon('fill 5 62 5 25 62 25 minecraft:stone');
  await test.rcon('fill 5 63 5 25 63 25 minecraft:grass_block');

  // River
  await test.rcon('fill 14 63 5 15 63 25 minecraft:water');

  // Sandy shores
  await test.rcon('fill 13 63 5 13 63 25 minecraft:sand');
  await test.rcon('fill 16 63 5 17 63 25 minecraft:sand');

  // Dirtpit
  await test.rcon('fill 35 62 35 45 62 45 minecraft:stone');
  await test.rcon('fill 35 63 35 45 63 45 minecraft:dirt');

  pathfinder(test.bot as any, { canDig: true, allowParkour: true, allowSprint: true });
  await test.wait(2000, 'World loading');

  const role = new GOAPLandscaperRole();
  role.start(test.bot, { logger: test.createRoleLogger('landscaper') });

  console.log('  🏝️  Mixed Terrain Test (River + Sand):');
  console.log(`     - Farm center at (${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z})`);
  console.log('     - River runs through area (x=14,15)');
  console.log('     - Sandy shores along river (x=13, 16, 17)');
  console.log('     - Bot must fill water AND replace sand with dirt');

  // Wait for the farm area to become farmable
  await test.waitUntil(
    () => {
      // Check the 9x9 area around farm center
      let farmableCount = 0;
      let total = 0;

      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (dx === 0 && dz === 0) continue; // Skip center

          const pos = new Vec3(farmCenter.x + dx, 63, farmCenter.z + dz);
          const block = test.blockAt(pos);
          total++;

          if (block === 'dirt' || block === 'grass_block' || block === 'farmland') {
            farmableCount++;
          }
        }
      }

      const percent = (farmableCount / total) * 100;
      console.log(`  [check] ${farmableCount}/${total} positions farmable (${percent.toFixed(1)}%)`);

      // Consider done when most positions are farmable
      return percent >= 85;
    },
    {
      timeout: 180000,
      interval: 5000,
      message: 'Bot should terraform mixed terrain into farmable land',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Water source at center must be intact
  const centerBlock = test.blockAt(farmCenter);
  test.assert(
    centerBlock === 'water' || centerBlock === 'flowing_water',
    `Water source at farm center should remain intact (was ${centerBlock})`
  );

  // 2. Count terrain types in the 9x9 area
  let farmableCount = 0;
  let waterCount = 0;
  let sandCount = 0;
  let otherCount = 0;
  const total = 80; // 9x9 - 1 center

  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (dx === 0 && dz === 0) continue;

      const pos = new Vec3(farmCenter.x + dx, 63, farmCenter.z + dz);
      const block = test.blockAt(pos);

      if (block === 'dirt' || block === 'grass_block' || block === 'farmland') {
        farmableCount++;
      } else if (block === 'water' || block === 'flowing_water') {
        waterCount++;
      } else if (block === 'sand') {
        sandCount++;
      } else {
        otherCount++;
      }
    }
  }

  console.log(`  📊 Final terrain breakdown:`);
  console.log(`     - Farmable (dirt/grass): ${farmableCount}/${total}`);
  console.log(`     - Water remaining: ${waterCount}/${total}`);
  console.log(`     - Sand remaining: ${sandCount}/${total}`);
  console.log(`     - Other: ${otherCount}/${total}`);

  const farmablePercent = (farmableCount / total) * 100;
  test.assert(
    farmablePercent >= 85,
    `At least 85% of farm area should be farmable (was ${farmablePercent.toFixed(1)}%)`
  );

  console.log(`  ✓ Mixed terrain terraformed - ${farmablePercent.toFixed(1)}% farmable`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
  'river': testFillsRiverWaterAroundFarmCenter,
  'sand': testReplacesSandWithDirt,
  'mixed': testHandlesMixedTerrain,
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
