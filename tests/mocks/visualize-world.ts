/**
 * Visualize MockWorld in a browser using prismarine-viewer.
 *
 * Usage:
 *   bun run tests/mocks/visualize-world.ts [world-name]
 *
 * World names:
 *   - forest (default)
 *   - stump-field
 *   - mixed
 *   - structure
 *
 * Then open http://localhost:3000 in your browser.
 */

import { Vec3 } from 'vec3';
// @ts-ignore - prismarine packages don't have great types
import { standalone as standaloneViewer } from 'prismarine-viewer';
// @ts-ignore
import mcData from 'minecraft-data';

import {
  MockWorld,
  createForestWorld,
  createStumpFieldWorld,
  createMixedWorld,
  createStructureWorld,
  createOakTree,
  createStump,
} from './MockWorld';

const VERSION = '1.20.1';
const PORT = 3000;

// Get minecraft data for block state lookups
const data = mcData(VERSION);

// @ts-ignore
const World = require('prismarine-world')(VERSION);
// @ts-ignore
const Chunk = require('prismarine-chunk')(VERSION);

// Log blocks that need vertical orientation (axis=y)
const LOG_BLOCKS = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'stripped_oak_log', 'stripped_birch_log', 'stripped_spruce_log',
  'stripped_jungle_log', 'stripped_acacia_log', 'stripped_dark_oak_log',
]);

/**
 * Map block names to state IDs.
 * For logs, uses vertical orientation (axis=y) for proper tree trunks.
 */
function getBlockStateId(blockName: string): number {
  if (blockName === 'air') return 0;

  const block = data.blocksByName[blockName];
  if (!block) {
    console.warn(`Unknown block: ${blockName}, using stone`);
    return data.blocksByName['stone']?.minStateId ?? 1;
  }

  // For log blocks, add 1 to get axis=y (vertical) orientation
  // State order is typically: axis=x (min), axis=y (+1), axis=z (+2)
  if (LOG_BLOCKS.has(blockName)) {
    return (block.minStateId ?? block.id ?? 0) + 1;
  }

  return block.minStateId ?? block.id ?? 0;
}

/**
 * Convert MockWorld to prismarine-world.
 */
function mockWorldToPrismarineWorld(mockWorld: MockWorld) {
  const allBlocks = mockWorld.getAllBlocks();

  // Find bounds of the mock world
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const block of allBlocks) {
    minX = Math.min(minX, block.position.x);
    maxX = Math.max(maxX, block.position.x);
    minZ = Math.min(minZ, block.position.z);
    maxZ = Math.max(maxZ, block.position.z);
  }

  // Calculate chunk range
  const minChunkX = Math.floor(minX / 16);
  const maxChunkX = Math.floor(maxX / 16);
  const minChunkZ = Math.floor(minZ / 16);
  const maxChunkZ = Math.floor(maxZ / 16);

  console.log(`World bounds: X[${minX}, ${maxX}] Z[${minZ}, ${maxZ}]`);
  console.log(`Chunk range: X[${minChunkX}, ${maxChunkX}] Z[${minChunkZ}, ${maxChunkZ}]`);
  console.log(`Total blocks: ${allBlocks.length}`);

  // Create a map for quick block lookup
  const blockMap = new Map<string, string>();
  for (const block of allBlocks) {
    const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
    blockMap.set(key, block.name);
  }

  // Create prismarine world with chunk generator
  const world = new World((chunkX: number, chunkZ: number) => {
    const chunk = new Chunk();

    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          const worldX = chunkX * 16 + x;
          const worldZ = chunkZ * 16 + z;
          const key = `${worldX},${y},${worldZ}`;

          const blockName = blockMap.get(key) ?? 'air';
          const stateId = getBlockStateId(blockName);

          chunk.setBlockStateId(new Vec3(x, y, z), stateId);
        }
      }
    }

    return chunk;
  });

  return world;
}

/**
 * Get or create a preset world by name.
 */
function getWorld(name: string): MockWorld {
  switch (name) {
    case 'forest':
      return createForestWorld();

    case 'stump-field':
      return createStumpFieldWorld();

    case 'mixed':
      return createMixedWorld();

    case 'structure':
      return createStructureWorld();

    case 'custom':
      // Create a custom test scenario
      const world = new MockWorld();
      world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

      // Dense forest cluster
      createOakTree(world, new Vec3(0, 64, 0), 5);
      createOakTree(world, new Vec3(5, 64, 3), 6);
      createOakTree(world, new Vec3(-4, 64, 2), 5);
      createOakTree(world, new Vec3(2, 64, -5), 4);

      // Some stumps nearby
      createStump(world, new Vec3(10, 64, 0));
      createStump(world, new Vec3(12, 64, 2));
      createStump(world, new Vec3(-10, 64, 5));

      // Isolated tree far away
      createOakTree(world, new Vec3(25, 64, 25), 7);

      return world;

    default:
      console.log(`Unknown world: ${name}, using forest`);
      return createForestWorld();
  }
}

// Main
const worldName = process.argv[2] ?? 'forest';
console.log(`Creating ${worldName} world...`);

const mockWorld = getWorld(worldName);
const prismarineWorld = mockWorldToPrismarineWorld(mockWorld);

console.log(`Starting viewer on http://localhost:${PORT}`);
console.log('Controls: WASD to move, mouse to look, space/shift for up/down');

standaloneViewer({
  version: VERSION,
  world: prismarineWorld,
  center: new Vec3(0, 70, 0), // Start above ground level
  port: PORT,
  viewDistance: 4,
});

console.log(`\nViewer ready! Open http://localhost:${PORT} in your browser.`);
