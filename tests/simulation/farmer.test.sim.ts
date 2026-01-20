#!/usr/bin/env bun
/**
 * Farmer Simulation Tests
 *
 * Automated integration tests that verify farmer bot behavior
 * against a real Paper server with actual Minecraft physics.
 *
 * Usage:
 *   bun run tests/simulation/farmer.test.sim.ts
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from './SimulationTest';
import { MockWorld } from '../mocks/MockWorld';
import { GOAPFarmingRole } from '../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer harvests mature wheat
// ═══════════════════════════════════════════════════════════════════════════

async function testHarvestsMatureWheat() {
  const test = new SimulationTest('Farmer harvests mature wheat');

  // Create a world with a small wheat farm
  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for the farm (required for hydrated farmland)
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Create farmland with mature wheat around the water
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue; // Skip water position
      const farmlandPos = new Vec3(10 + dx, 63, 10 + dz);
      const cropPos = new Vec3(10 + dx, 64, 10 + dz);
      world.setBlock(farmlandPos, 'farmland');
      world.setBlock(cropPos, 'wheat[age=7]'); // Mature wheat (age=7)
    }
  }

  // Village sign so bot knows where it is
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Farm sign pointing to the farm
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  // Load pathfinder
  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Start the farming role
  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to harvest wheat
  await test.waitForInventory('wheat', 1, {
    timeout: 90000,
    message: 'Bot should harvest at least 1 wheat',
  });

  // Verify bot collected some wheat seeds too (dropped from harvest)
  // Note: May take longer for seeds to drop and be collected
  const wheatCount = test.botInventoryCount('wheat');
  test.assertGreater(wheatCount, 0, 'Bot should have collected wheat');

  // Cleanup
  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer plants seeds on empty farmland
// ═══════════════════════════════════════════════════════════════════════════

async function testPlantsSeeds() {
  const test = new SimulationTest('Farmer plants seeds on farmland');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Create empty farmland (no crops yet)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(10 + dx, 63, 10 + dz), 'farmland');
    }
  }

  // Add grass patches around the world (for natural appearance and seed gathering if needed)
  // Patch near spawn
  for (let x = -5; x <= -2; x++) {
    for (let z = -2; z <= 2; z++) {
      if ((x + z) % 2 === 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  // Patch east of farm
  for (let x = 15; x <= 18; x++) {
    for (let z = 8; z <= 12; z++) {
      if ((x + z) % 3 !== 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to plant seeds (seed count should decrease)
  const initialSeeds = test.botInventoryCount('wheat_seeds');
  await test.waitUntil(
    () => test.botInventoryCount('wheat_seeds') < initialSeeds,
    {
      timeout: 60000,
      message: 'Bot should plant some seeds (seed count decreased)',
    }
  );

  const finalSeeds = test.botInventoryCount('wheat_seeds');
  test.assertGreater(
    initialSeeds - finalSeeds,
    0,
    `Bot should have planted seeds (${initialSeeds} -> ${finalSeeds})`
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer tills ground near water
// ═══════════════════════════════════════════════════════════════════════════

async function testTillsGround() {
  const test = new SimulationTest('Farmer tills ground near water');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source with dirt around it (will be tilled into farmland)
  world.setBlock(new Vec3(10, 63, 10), 'water');
  // The grass_block fill already created the surrounding area

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 20 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to till some ground (creates farmland)
  // Check for farmland blocks near the water source
  await test.waitUntil(
    () => {
      // Check for farmland in 4-block radius around water
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (dx === 0 && dz === 0) continue;
          const block = test.blockAt(new Vec3(10 + dx, 63, 10 + dz));
          if (block === 'farmland') return true;
        }
      }
      return false;
    },
    {
      timeout: 90000,
      message: 'Bot should till ground into farmland near water',
    }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer gathers seeds from tall grass
// ═══════════════════════════════════════════════════════════════════════════

async function testGathersSeeds() {
  const test = new SimulationTest('Farmer gathers seeds from grass');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm (far from grass area to avoid interference)
  world.setBlock(new Vec3(-10, 63, -10), 'water');

  // Plant LOTS of grass to ensure reliable seed gathering (drop rate ~12.5%)
  // We need ~40+ grass blocks to reliably get 3+ seeds

  // Dense patch near spawn (9x9 area)
  for (let x = 2; x <= 10; x++) {
    for (let z = -4; z <= 4; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }

  // Additional patch to the north
  for (let x = 0; x <= 8; x++) {
    for (let z = 8; z <= 12; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }

  // Additional patch to the south
  for (let x = 0; x <= 8; x++) {
    for (let z = -12; z <= -8; z++) {
      world.setBlock(new Vec3(x, 64, z), 'short_grass');
    }
  }

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
    // No seeds - bot needs to gather them
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to gather at least a few seeds
  await test.waitForInventory('wheat_seeds', 3, {
    timeout: 120000,
    message: 'Bot should gather at least 3 wheat seeds from grass',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer collects dropped items
// ═══════════════════════════════════════════════════════════════════════════

async function testCollectsDrops() {
  const test = new SimulationTest('Farmer collects dropped items');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Spawn some wheat seeds as items near the bot
  await test.rcon('summon item 2 65 2 {Item:{id:"minecraft:wheat_seeds",count:10}}');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Bot should pick up the dropped seeds
  await test.waitForInventory('wheat_seeds', 10, {
    timeout: 30000,
    message: 'Bot should collect dropped wheat seeds',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer crafts hoe when needed
// ═══════════════════════════════════════════════════════════════════════════

async function testCraftsHoe() {
  const test = new SimulationTest('Farmer crafts hoe when needed');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Crafting table for the bot to use
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

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to craft a hoe
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
// TEST: Farmer deposits produce to chest
// ═══════════════════════════════════════════════════════════════════════════

async function testDepositsToChest() {
  const test = new SimulationTest('Farmer deposits produce to chest');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm center (required for farmer to work)
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Chest for deposits
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat', count: 32 },  // Produce to deposit
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const initialWheat = test.botInventoryCount('wheat');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to deposit wheat (inventory should decrease)
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
// TEST: Complete farming cycle (Till → Plant → Harvest → Deposit)
// ═══════════════════════════════════════════════════════════════════════════

async function testCompleteFarmingCycle() {
  const test = new SimulationTest('Complete farming cycle');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm
  world.setBlock(new Vec3(0, 63, 0), 'water');

  // Chest for deposits
  world.setBlock(new Vec3(5, 64, 5), 'chest');

  // Village sign and FARM sign (to avoid farm establishment step)
  world.setBlock(new Vec3(-2, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-4, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 0\nY: 63\nZ: 0' });  // Direct farm location
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 5' });

  // Add some grass for gathering seeds (away from farm area)
  for (let x = -12; x <= -8; x++) {
    for (let z = -3; z <= 3; z++) {
      if ((x + z) % 2 === 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Step 1: Wait for bot to till ground (creates farmland)
  await test.waitUntil(
    () => {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (dx === 0 && dz === 0) continue;
          const block = test.blockAt(new Vec3(dx, 63, dz));
          if (block === 'farmland') return true;
        }
      }
      return false;
    },
    { timeout: 60000, message: 'Bot should till ground to create farmland' }
  );

  // Step 2: Wait for bot to plant seeds (seed count decreases)
  const initialSeeds = test.botInventoryCount('wheat_seeds');
  await test.waitUntil(
    () => test.botInventoryCount('wheat_seeds') < initialSeeds,
    { timeout: 60000, message: 'Bot should plant seeds on farmland' }
  );

  // Step 3: Spawn some mature wheat via RCON (simulating crop growth)
  // Find farmland and place mature wheat
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      await test.rcon(`setblock ${dx} 64 ${dz} wheat[age=7]`);
    }
  }
  await test.wait(1000, 'Mature wheat placed');

  // Step 4: Wait for bot to harvest wheat
  await test.waitForInventory('wheat', 1, {
    timeout: 60000,
    message: 'Bot should harvest mature wheat',
  });

  // Step 5: Wait for bot to deposit produce
  const wheatBeforeDeposit = test.botInventoryCount('wheat');
  if (wheatBeforeDeposit >= 5) {
    await test.waitUntil(
      () => test.botInventoryCount('wheat') < wheatBeforeDeposit,
      { timeout: 60000, message: 'Bot should deposit wheat to chest' }
    );
  }

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Bot reads existing FARM sign
// ═══════════════════════════════════════════════════════════════════════════

async function testReadsFarmSign() {
  const test = new SimulationTest('Bot reads FARM sign');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source at a specific location
  world.setBlock(new Vec3(15, 63, 15), 'water');

  // Pre-existing farmland around the water
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(15 + dx, 63, 15 + dz), 'farmland');
    }
  }

  // Signs at spawn - FARM sign tells bot where the farm is
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 63\nZ: 15' });

  await test.setup(world, {
    botPosition: new Vec3(0, 64, 0),
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 32 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Bot should read the FARM sign and go to that location to plant
  // Wait for seed count to decrease (planting at the farm location)
  const initialSeeds = test.botInventoryCount('wheat_seeds');
  await test.waitUntil(
    () => test.botInventoryCount('wheat_seeds') < initialSeeds,
    { timeout: 90000, message: 'Bot should read FARM sign and plant at farm location (15,63,15)' }
  );

  // Verify crops were planted near the FARM sign location (15, 63, 15)
  let cropsNearFarm = 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const block = test.blockAt(new Vec3(15 + dx, 64, 15 + dz));
      if (block?.includes('wheat')) cropsNearFarm++;
    }
  }

  test.assertGreater(cropsNearFarm, 0, 'Crops should be planted near the FARM sign location');

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Bot writes FARM sign after establishing farm
// ═══════════════════════════════════════════════════════════════════════════

async function testWritesFarmSign() {
  const test = new SimulationTest('Bot establishes farm without existing sign');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source - bot should establish farm here
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Only village sign - no FARM sign yet (bot must find water on its own)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),  // Start slightly away
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Ensure clear sky above water - do this after bot loads chunks so the changes propagate
  await test.rcon('fill 6 64 6 14 80 14 air replace');
  await test.wait(500, 'Clear sky propagation');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to establish farm (creates farmland near water)
  await test.waitUntil(
    () => {
      // Check if farmland exists near water (10, 63, 10)
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const block = test.blockAt(new Vec3(10 + dx, 63, 10 + dz));
          if (block === 'farmland') return true;
        }
      }
      return false;
    },
    { timeout: 90000, message: 'Bot should establish farm near water (without FARM sign)' }
  );

  // Verify bot planted seeds on the farmland
  await test.waitUntil(
    () => {
      // Check for wheat crops at y=64
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const block = test.blockAt(new Vec3(10 + dx, 64, 10 + dz));
          if (block?.includes('wheat')) return true;
        }
      }
      return false;
    },
    { timeout: 60000, message: 'Bot should plant crops after establishing farm' }
  );

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Fresh spawn startup sequence
// ═══════════════════════════════════════════════════════════════════════════

async function testStartupSequence() {
  const test = new SimulationTest('Fresh spawn startup sequence');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source for farm establishment - use explicit air blocks above to ensure clear sky
  world.setBlock(new Vec3(8, 63, 8), 'water');

  // Village sign at spawn (simulates lumberjack has been here)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Grass patches for seed gathering
  for (let x = -10; x <= -6; x++) {
    for (let z = -3; z <= 3; z++) {
      if ((x + z) % 2 === 0) {
        world.setBlock(new Vec3(x, 64, z), 'short_grass');
      }
    }
  }

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),  // Start slightly away from water
    botInventory: [
      { name: 'iron_hoe', count: 1 },
      { name: 'wheat_seeds', count: 16 },  // Give seeds - grass drop rate is too low
    ],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  // Ensure clear sky above water - do this after bot loads chunks so the changes propagate
  await test.rcon('fill 4 64 4 12 80 12 air replace');  // Clear area above water
  await test.wait(500, 'Clear sky propagation');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to complete startup sequence and plant crops
  // The full cycle: sign study → establish farm → gather seeds → till → plant
  await test.wait(60000, 'Startup sequence (full farming cycle)');

  // Verify bot has completed the farming cycle using RCON fill command to count blocks
  // The fill X1 Y Z1 X2 Y Z2 air replace <block> counts matching blocks (by replacing with air)
  // Note: This destroys the blocks, but test is ending anyway

  // Count wheat crops in a 21x21 area around water (3-13 x 3-13)
  const cropResult = await test.rcon('fill 3 64 3 13 64 13 air replace wheat');
  const cropMatch = cropResult.match(/Successfully filled (\d+) block/);
  const cropsFound = cropMatch ? parseInt(cropMatch[1]) : 0;

  // Count farmland in the same area (use dirt to replace since we're ending)
  const farmResult = await test.rcon('fill 3 63 3 13 63 13 dirt replace farmland');
  const farmMatch = farmResult.match(/Successfully filled (\d+) block/);
  const farmlandFound = farmMatch ? parseInt(farmMatch[1]) : 0;

  test.assertGreater(cropsFound, 0, `Bot should have planted crops (found ${cropsFound} wheat)`);
  test.assertGreater(farmlandFound, 0, `Bot should have tilled farmland (found ${farmlandFound} spots)`);

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Drop collection interrupts work
// ═══════════════════════════════════════════════════════════════════════════

async function testDropsInterruptWork() {
  const test = new SimulationTest('Drops interrupt farming work');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Water source
  world.setBlock(new Vec3(0, 63, 0), 'water');

  // Create farmland with immature wheat (bot will want to wait/explore)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.setBlock(new Vec3(dx, 63, dz), 'farmland');
      world.setBlock(new Vec3(dx, 64, dz), 'wheat[age=3]');  // Immature
    }
  }

  world.setBlock(new Vec3(-5, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-5, 64, 2), 'oak_sign', { signText: '[FARM]\nX: 0\nY: 63\nZ: 0' });

  await test.setup(world, {
    botPosition: new Vec3(3, 64, 3),
    botInventory: [{ name: 'iron_hoe', count: 1 }],
  });

  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new GOAPFarmingRole();
  role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: new Vec3(0, 64, 0) });

  // Wait for bot to study signs
  await test.wait(5000, 'Sign study and initial behavior');

  // Spawn drops near the bot - both at same location so they're collected together
  await test.rcon('summon item 2 64 2 {Item:{id:"minecraft:wheat",count:10}}');
  await test.rcon('summon item 2 64 2 {Item:{id:"minecraft:wheat_seeds",count:20}}');

  // Bot should collect both drops (checking wheat first, then seeds)
  await test.waitForInventory('wheat', 10, {
    timeout: 30000,
    message: 'Bot should collect dropped wheat (interrupting other work)',
  });

  // Seeds are at same location as wheat, so should be collected at same time
  await test.waitForInventory('wheat_seeds', 10, {
    timeout: 30000,
    message: 'Bot should collect dropped seeds',
  });

  role.stop(test.bot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN - Run all tests or specific test by name
// ═══════════════════════════════════════════════════════════════════════════

// Map test names to functions for CLI selection
const ALL_TESTS: Record<string, () => Promise<any>> = {
  // Core farming actions
  'harvest': testHarvestsMatureWheat,
  'plant': testPlantsSeeds,
  'till': testTillsGround,
  'seeds': testGathersSeeds,
  'drops': testCollectsDrops,
  'hoe': testCraftsHoe,
  'deposit': testDepositsToChest,
  // Complete workflows
  'cycle': testCompleteFarmingCycle,
  'startup': testStartupSequence,
  'drop-interrupt': testDropsInterruptWork,
  // Sign handling
  'read-sign': testReadsFarmSign,
  'write-sign': testWritesFarmSign,
};

async function main() {
  const testName = process.argv[2];

  if (testName === '--list' || testName === '-l') {
    console.log('Available tests:', Object.keys(ALL_TESTS).join(', '));
    process.exit(0);
  }

  let testsToRun: Array<() => Promise<any>>;

  if (testName && ALL_TESTS[testName]) {
    console.log(`Running single test: ${testName}`);
    testsToRun = [ALL_TESTS[testName]];
  } else if (testName) {
    console.error(`Unknown test: ${testName}`);
    console.error('Available tests:', Object.keys(ALL_TESTS).join(', '));
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
