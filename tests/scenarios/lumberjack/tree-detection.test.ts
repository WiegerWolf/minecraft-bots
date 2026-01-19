import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { createBotMock } from '../../mocks/BotMock';
import {
  MockWorld,
  createForestWorld,
  createStumpFieldWorld,
  createMixedWorld,
  createStructureWorld,
  createOakTree,
  createStump,
} from '../../mocks/MockWorld';

// Import the actual detection functions we want to test
// We'll need to export these from LumberjackBlackboard or create a utility module

/**
 * Helper to check if a log has leaves attached.
 * Mirrors the logic in LumberjackBlackboard.ts hasLeavesAttached()
 */
function hasLeavesAttached(
  world: MockWorld,
  logPos: Vec3,
  validLeaves: string[],
  searchRadius: number = 5,
  minLeaves: number = 3
): boolean {
  let leafCount = 0;

  for (let dy = 0; dy <= searchRadius + 3; dy++) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        const horizontalDist = Math.abs(dx) + Math.abs(dz);
        if (horizontalDist > searchRadius) continue;

        const checkPos = logPos.offset(dx, dy, dz);
        const block = world.blockAt(checkPos);

        if (block && validLeaves.includes(block.name)) {
          leafCount++;
          if (leafCount >= minLeaves) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Find all logs in a world within a radius.
 */
function findLogs(world: MockWorld, center: Vec3, radius: number, logNames: string[]): Vec3[] {
  return world.findBlocks({
    point: center,
    maxDistance: radius,
    count: 100,
    matching: (block) => block !== null && logNames.includes(block.name),
  });
}

describe('Tree Detection with MockWorld', () => {
  const LOG_NAMES = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
  const OAK_LEAVES = ['oak_leaves'];

  describe('SPEC: hasLeavesAttached correctly identifies trees vs stumps', () => {
    test('returns true for a standing tree with leaves', () => {
      const world = new MockWorld();
      createOakTree(world, new Vec3(0, 64, 0), 5);

      // Check the base log
      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
      expect(hasLeaves).toBe(true);
    });

    test('returns false for a stump (log without leaves)', () => {
      const world = new MockWorld();
      createStump(world, new Vec3(0, 64, 0));

      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
      expect(hasLeaves).toBe(false);
    });

    test('returns true for logs higher up in a tree (still connected to canopy)', () => {
      const world = new MockWorld();
      createOakTree(world, new Vec3(0, 64, 0), 6);

      // Check a log midway up the trunk
      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 66, 0), OAK_LEAVES);
      expect(hasLeaves).toBe(true);
    });

    test('returns false for isolated logs (no nearby leaves)', () => {
      const world = new MockWorld();
      // Place a single log with nothing around it
      world.setBlock(new Vec3(0, 64, 0), 'oak_log');
      world.setBlock(new Vec3(0, 63, 0), 'grass_block');

      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
      expect(hasLeaves).toBe(false);
    });
  });

  describe('SPEC: Forest detection in preset worlds', () => {
    test('forest world: finds multiple trees with leaves', () => {
      const world = createForestWorld();
      const center = new Vec3(0, 64, 0);

      const logs = findLogs(world, center, 32, LOG_NAMES);
      expect(logs.length).toBeGreaterThan(0);

      // Count logs that have leaves (real trees)
      const treesWithLeaves = logs.filter(pos =>
        hasLeavesAttached(world, pos, OAK_LEAVES)
      );

      // Should find at least 3 trees (the forest has 5)
      expect(treesWithLeaves.length).toBeGreaterThanOrEqual(3);
    });

    test('stump field: finds logs but none have leaves', () => {
      const world = createStumpFieldWorld();
      const center = new Vec3(0, 64, 0);

      const logs = findLogs(world, center, 32, LOG_NAMES);
      expect(logs.length).toBeGreaterThan(0);

      // None should have leaves
      const treesWithLeaves = logs.filter(pos =>
        hasLeavesAttached(world, pos, OAK_LEAVES)
      );

      expect(treesWithLeaves.length).toBe(0);
    });

    test('mixed world: stumps nearby but trees further away', () => {
      const world = createMixedWorld();

      // Search from origin with small radius - should only find stumps
      const nearbyLogs = findLogs(world, new Vec3(0, 64, 0), 20, LOG_NAMES);
      const nearbyTrees = nearbyLogs.filter(pos =>
        hasLeavesAttached(world, pos, OAK_LEAVES)
      );
      expect(nearbyTrees.length).toBe(0);

      // Search with larger radius - should find trees
      const allLogs = findLogs(world, new Vec3(0, 64, 0), 40, LOG_NAMES);
      const allTrees = allLogs.filter(pos =>
        hasLeavesAttached(world, pos, OAK_LEAVES)
      );
      expect(allTrees.length).toBeGreaterThan(0);
    });

    test('structure world: rejects structure logs, accepts real tree', () => {
      const world = createStructureWorld();
      const center = new Vec3(0, 64, 0);

      const logs = findLogs(world, center, 32, LOG_NAMES);
      expect(logs.length).toBeGreaterThan(0);

      // Count real trees
      const treesWithLeaves = logs.filter(pos =>
        hasLeavesAttached(world, pos, OAK_LEAVES)
      );

      // Should find only the real tree (at -10, 64, 0), not the structure logs
      expect(treesWithLeaves.length).toBeGreaterThan(0);

      // Verify the structure logs at (0,64,0) don't count as trees
      const structureLog = new Vec3(0, 64, 0);
      expect(hasLeavesAttached(world, structureLog, OAK_LEAVES)).toBe(false);
    });
  });

  describe('SPEC: Bot integration with MockWorld', () => {
    test('bot.blockAt returns blocks from MockWorld', () => {
      const world = new MockWorld();
      world.setBlock(new Vec3(5, 64, 5), 'oak_log');

      const bot = createBotMock({ world });

      const block = bot.blockAt(new Vec3(5, 64, 5));
      expect(block).not.toBeNull();
      expect(block?.name).toBe('oak_log');
    });

    test('bot.blockAt returns air for empty positions (like real Minecraft)', () => {
      const world = new MockWorld();
      const bot = createBotMock({ world });

      const block = bot.blockAt(new Vec3(100, 100, 100));
      expect(block).not.toBeNull();
      expect(block?.name).toBe('air');
    });

    test('bot.findBlocks finds blocks in MockWorld', () => {
      const world = createForestWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });

      const logs = bot.findBlocks({
        point: bot.entity.position,
        maxDistance: 32,
        count: 50,
        matching: (block: any) => block && LOG_NAMES.includes(block.name),
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    test('bot positioned in stump field finds only stumps', () => {
      const world = createStumpFieldWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });

      const logs = bot.findBlocks({
        point: bot.entity.position,
        maxDistance: 32,
        count: 50,
        matching: (block: any) => block && LOG_NAMES.includes(block.name),
      });

      // All found logs should be stumps (no leaves)
      for (const logPos of logs) {
        const hasLeaves = hasLeavesAttached(world, logPos, OAK_LEAVES);
        expect(hasLeaves).toBe(false);
      }
    });
  });

  describe('SPEC: Edge cases', () => {
    test('tall trees: leaves detected from base log', () => {
      const world = new MockWorld();
      // Create a very tall tree (trunk height 8)
      createOakTree(world, new Vec3(0, 64, 0), 8);

      // Base log should still detect leaves even though canopy is high
      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
      expect(hasLeaves).toBe(true);
    });

    test('short trees: leaves detected from base log', () => {
      const world = new MockWorld();
      // Create a short tree (trunk height 3)
      createOakTree(world, new Vec3(0, 64, 0), 3);

      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
      expect(hasLeaves).toBe(true);
    });

    test('multiple adjacent stumps: none detected as trees', () => {
      const world = new MockWorld();
      world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'grass_block');

      // Create a grid of stumps
      for (let x = -3; x <= 3; x += 2) {
        for (let z = -3; z <= 3; z += 2) {
          createStump(world, new Vec3(x, 64, z));
        }
      }

      const logs = findLogs(world, new Vec3(0, 64, 0), 10, LOG_NAMES);
      expect(logs.length).toBeGreaterThan(0);

      // None should have leaves
      const treesWithLeaves = logs.filter(pos =>
        hasLeavesAttached(world, pos, OAK_LEAVES)
      );
      expect(treesWithLeaves.length).toBe(0);
    });

    test('leaf count threshold: requires minimum 3 leaves', () => {
      const world = new MockWorld();
      world.setBlock(new Vec3(0, 63, 0), 'grass_block');
      world.setBlock(new Vec3(0, 64, 0), 'oak_log');
      // Only 2 leaves - below threshold
      world.setBlock(new Vec3(0, 65, 0), 'oak_leaves');
      world.setBlock(new Vec3(1, 65, 0), 'oak_leaves');

      const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES, 5, 3);
      expect(hasLeaves).toBe(false);

      // Add a third leaf
      world.setBlock(new Vec3(-1, 65, 0), 'oak_leaves');
      const hasEnoughLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES, 5, 3);
      expect(hasEnoughLeaves).toBe(true);
    });
  });
});
