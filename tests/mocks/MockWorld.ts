import { Vec3 } from 'vec3';

/**
 * Mock block for testing world interactions.
 * Mimics prismarine-block's Block interface for the properties we use.
 */
export interface MockBlock {
  name: string;
  position: Vec3;
  type: number;
  metadata: number;
  // For signs
  signText?: string;
  // Block interface compatibility
  stateId?: number;
  hardness?: number;
  boundingBox?: string;
  transparent?: boolean;
}

/**
 * Blocks that are transparent (light passes through).
 * Note: This does NOT mean walkable - leaves and glass are transparent but block movement.
 */
const TRANSPARENT_BLOCKS = new Set([
  'air', 'water', 'flowing_water', 'lava', 'flowing_lava',
  // Vegetation (passable)
  'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
  'dead_bush', 'sweet_berry_bush', 'seagrass', 'tall_seagrass',
  'leaf_litter',
  // Leaves (transparent but NOT passable - blocks movement)
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
  'azalea_leaves', 'flowering_azalea_leaves',
  // Glass (transparent but NOT passable)
  'glass', 'glass_pane', 'white_stained_glass', 'orange_stained_glass',
  // Misc transparent
  'torch', 'wall_torch', 'lantern', 'redstone_torch',
]);

/**
 * Create a mock block with Vec3 position (matches prismarine-block interface).
 */
function createMockBlock(name: string, x: number, y: number, z: number, signText?: string): MockBlock {
  return {
    name,
    position: new Vec3(x, y, z),
    type: 0,
    metadata: 0,
    signText,
    transparent: TRANSPARENT_BLOCKS.has(name),
  };
}

/**
 * MockWorld - A simple 3D grid of blocks for testing.
 *
 * Usage:
 * ```typescript
 * const world = new MockWorld();
 * world.setBlock(new Vec3(0, 64, 0), 'grass_block');
 * world.setBlock(new Vec3(0, 65, 0), 'oak_log');
 *
 * const bot = createBotMockWithWorld(world, { position: new Vec3(5, 64, 5) });
 * // Now bot.blockAt() and bot.findBlocks() work with this world
 * ```
 */
export class MockWorld {
  private blocks: Map<string, MockBlock> = new Map();
  private defaultBlock: string | null = 'air';  // Return 'air' for unset positions (like real Minecraft)

  /**
   * Get the key for a position (floored to integers).
   */
  private getKey(pos: Vec3): string {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  /**
   * Set default block for unset positions.
   * Set to null to return null for unset positions (like unloaded chunks).
   */
  setDefaultBlock(name: string | null): void {
    this.defaultBlock = name;
  }

  /**
   * Set a block at a position.
   */
  setBlock(pos: Vec3, name: string, options?: { signText?: string }): void {
    const key = this.getKey(pos);
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    this.blocks.set(key, createMockBlock(name, x, y, z, options?.signText));
  }

  /**
   * Set multiple blocks at once.
   */
  setBlocks(blocks: Array<{ pos: Vec3; name: string; signText?: string }>): void {
    for (const block of blocks) {
      this.setBlock(block.pos, block.name, { signText: block.signText });
    }
  }

  /**
   * Fill a region with a block type.
   */
  fill(from: Vec3, to: Vec3, name: string): void {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    const minZ = Math.min(from.z, to.z);
    const maxZ = Math.max(from.z, to.z);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setBlock(new Vec3(x, y, z), name);
        }
      }
    }
  }

  /**
   * Get a block at a position (implements bot.blockAt behavior).
   * Returns default block (usually 'air') for unset positions.
   */
  blockAt(pos: Vec3): MockBlock | null {
    const key = this.getKey(pos);
    const block = this.blocks.get(key);
    if (block) return block;

    // Return default block for unset positions
    if (this.defaultBlock) {
      const x = Math.floor(pos.x);
      const y = Math.floor(pos.y);
      const z = Math.floor(pos.z);
      return createMockBlock(this.defaultBlock, x, y, z);
    }
    return null;
  }

  /**
   * Find blocks matching criteria (implements bot.findBlocks behavior).
   * Only searches explicitly set blocks (not the entire world filled with air).
   */
  findBlocks(options: {
    point: Vec3;
    maxDistance: number;
    count: number;
    matching: (block: MockBlock | null) => boolean;
  }): Vec3[] {
    const { point, maxDistance, count, matching } = options;
    const results: Array<{ pos: Vec3; dist: number }> = [];

    // Only iterate over explicitly set blocks (not air everywhere)
    for (const block of this.blocks.values()) {
      const dist = block.position.distanceTo(point);
      if (dist > maxDistance) continue;

      if (matching(block)) {
        results.push({ pos: block.position.clone(), dist });
      }
    }

    // Sort by distance and return top N
    results.sort((a, b) => a.dist - b.dist);
    return results.slice(0, count).map(r => r.pos);
  }

  /**
   * Clear all blocks.
   */
  clear(): void {
    this.blocks.clear();
  }

  /**
   * Get all blocks (for debugging).
   */
  getAllBlocks(): MockBlock[] {
    return Array.from(this.blocks.values());
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TREE BUILDERS - Helpers to create realistic tree structures
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a simple oak tree at the given position.
 * Standard oak: 4-6 block trunk, ~5x5 leaf canopy
 */
export function createOakTree(world: MockWorld, basePos: Vec3, trunkHeight: number = 5): void {
  // Ground
  world.setBlock(basePos.offset(0, -1, 0), 'grass_block');

  // Trunk
  for (let y = 0; y < trunkHeight; y++) {
    world.setBlock(basePos.offset(0, y, 0), 'oak_log');
  }

  // Leaves (simplified canopy)
  const leafStart = trunkHeight - 2;
  for (let y = leafStart; y <= trunkHeight + 1; y++) {
    const radius = y === trunkHeight + 1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        // Skip corners for more natural shape
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && y !== leafStart) continue;
        // Don't overwrite trunk
        if (dx === 0 && dz === 0 && y < trunkHeight) continue;
        world.setBlock(basePos.offset(dx, y, dz), 'oak_leaves');
      }
    }
  }
}

/**
 * Create a tree stump (log on ground, no leaves).
 */
export function createStump(world: MockWorld, pos: Vec3, logType: string = 'oak_log'): void {
  world.setBlock(pos.offset(0, -1, 0), 'grass_block');
  world.setBlock(pos, logType);
}

/**
 * Create a birch tree (taller, narrower canopy).
 */
export function createBirchTree(world: MockWorld, basePos: Vec3, trunkHeight: number = 7): void {
  world.setBlock(basePos.offset(0, -1, 0), 'grass_block');

  for (let y = 0; y < trunkHeight; y++) {
    world.setBlock(basePos.offset(0, y, 0), 'birch_log');
  }

  const leafStart = trunkHeight - 3;
  for (let y = leafStart; y <= trunkHeight; y++) {
    const radius = y >= trunkHeight - 1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx === 0 && dz === 0 && y < trunkHeight) continue;
        world.setBlock(basePos.offset(dx, y, dz), 'birch_leaves');
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESET WORLDS - Ready-to-use test scenarios
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a forest with multiple oak trees.
 */
export function createForestWorld(): MockWorld {
  const world = new MockWorld();

  // Ground layer
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Create a cluster of trees
  createOakTree(world, new Vec3(0, 64, 0), 5);
  createOakTree(world, new Vec3(5, 64, 3), 6);
  createOakTree(world, new Vec3(-4, 64, 2), 5);
  createOakTree(world, new Vec3(2, 64, -5), 4);
  createOakTree(world, new Vec3(-3, 64, -4), 5);

  return world;
}

/**
 * Create a deforested area with only stumps.
 */
export function createStumpFieldWorld(): MockWorld {
  const world = new MockWorld();

  // Ground layer
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Scattered stumps (logs at ground level, no leaves)
  createStump(world, new Vec3(0, 64, 0));
  createStump(world, new Vec3(3, 64, 2));
  createStump(world, new Vec3(-2, 64, 4));
  createStump(world, new Vec3(5, 64, -1));
  createStump(world, new Vec3(-4, 64, -3));
  createStump(world, new Vec3(1, 64, 6));

  return world;
}

/**
 * Create a mixed area: some stumps near spawn, forest further away.
 */
export function createMixedWorld(): MockWorld {
  const world = new MockWorld();

  // Ground layer
  world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

  // Stumps near origin (within 15 blocks)
  createStump(world, new Vec3(0, 64, 0));
  createStump(world, new Vec3(3, 64, 2));
  createStump(world, new Vec3(-2, 64, 4));
  createStump(world, new Vec3(5, 64, -1));
  createStump(world, new Vec3(-4, 64, -3));

  // Forest further away (25-35 blocks from origin)
  createOakTree(world, new Vec3(28, 64, 0), 5);
  createOakTree(world, new Vec3(30, 64, 5), 6);
  createOakTree(world, new Vec3(32, 64, -3), 5);
  createOakTree(world, new Vec3(25, 64, 8), 4);

  return world;
}

/**
 * Create a world with wooden structures (should not be detected as trees).
 */
export function createStructureWorld(): MockWorld {
  const world = new MockWorld();

  // Ground layer
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Wooden house frame (horizontal logs = not trees)
  // Floor beams
  for (let x = 0; x < 5; x++) {
    world.setBlock(new Vec3(x, 64, 0), 'oak_log');
    world.setBlock(new Vec3(x, 64, 4), 'oak_log');
  }
  // Wall posts
  world.setBlock(new Vec3(0, 65, 0), 'oak_log');
  world.setBlock(new Vec3(0, 66, 0), 'oak_log');
  world.setBlock(new Vec3(4, 65, 0), 'oak_log');
  world.setBlock(new Vec3(4, 66, 0), 'oak_log');

  // Real tree nearby for comparison
  createOakTree(world, new Vec3(-10, 64, 0), 5);

  return world;
}
