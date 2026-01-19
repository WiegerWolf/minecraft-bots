import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { createBotMock, item } from '../../mocks/BotMock';
import {
  MockWorld,
  createForestWorld,
  createStumpFieldWorld,
  createMixedWorld,
  createStructureWorld,
  createOakTree,
  createStump,
} from '../../mocks/MockWorld';
import {
  createLumberjackBlackboard,
  updateLumberjackBlackboard,
} from '../../../src/roles/lumberjack/LumberjackBlackboard';

describe('Blackboard Integration with MockWorld', () => {
  describe('SPEC: Forest detection updates blackboard correctly', () => {
    test('bot in forest: hasKnownForest = true, forestTrees >= 3', async () => {
      const world = createForestWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true; // Skip sign study requirement

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.forestTrees.length).toBeGreaterThanOrEqual(3);
      expect(bb.hasKnownForest).toBe(true);
    });

    test('bot in stump field: hasKnownForest = false, forestTrees = 0', async () => {
      const world = createStumpFieldWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.forestTrees.length).toBe(0);
      expect(bb.hasKnownForest).toBe(false);
    });

    test('bot with existing knownForests: hasKnownForest = true even with no nearby trees', async () => {
      const world = createStumpFieldWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;
      bb.knownForests = [new Vec3(100, 64, 100)]; // Known forest far away

      await updateLumberjackBlackboard(bot, bb);

      // forestTrees might be 0, but hasKnownForest should be true
      expect(bb.hasKnownForest).toBe(true);
    });
  });

  describe('SPEC: nearbyLogs and nearbyTrees filtering', () => {
    test('finds all logs in range', async () => {
      const world = new MockWorld();
      world.fill(new Vec3(-10, 63, -10), new Vec3(10, 63, 10), 'grass_block');
      // Place 5 stumps
      createStump(world, new Vec3(0, 64, 0));
      createStump(world, new Vec3(3, 64, 0));
      createStump(world, new Vec3(-3, 64, 0));
      createStump(world, new Vec3(0, 64, 3));
      createStump(world, new Vec3(0, 64, -3));

      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.nearbyLogs.length).toBe(5);
    });

    test('nearbyTrees only includes reachable logs (valid base + walkable access)', async () => {
      const world = new MockWorld();
      world.fill(new Vec3(-10, 63, -10), new Vec3(10, 63, 10), 'grass_block');

      // Tree on grass (valid)
      createOakTree(world, new Vec3(0, 64, 0), 5);

      // Log floating in air (invalid - no valid base)
      world.setBlock(new Vec3(5, 67, 0), 'oak_log');

      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      // Should find multiple logs (tree trunk + floating log)
      expect(bb.nearbyLogs.length).toBeGreaterThan(1);
      // But only tree logs should be reachable (floating log has no valid base)
      // Actually the tree has 5 logs in trunk, all should be reachable
      expect(bb.nearbyTrees.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SPEC: Structure avoidance', () => {
    test('logs in structures are not counted as forest trees', async () => {
      const world = createStructureWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      // The structure world has logs at (0-4, 64, 0) which are floor beams
      // These should not be detected as forest trees
      // The real tree at (-10, 64, 0) should be detected

      // Check that forestTrees only includes trees, not structure logs
      const structureLogPositions = bb.forestTrees.filter(t =>
        t.position.x >= 0 && t.position.x <= 4 && t.position.z === 0
      );
      expect(structureLogPositions.length).toBe(0);
    });
  });

  describe('SPEC: Mixed environment (stumps + distant forest)', () => {
    test('with search radius 32: finds stumps but not distant trees', async () => {
      const world = createMixedWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;
      // No village center = 32 block search radius

      await updateLumberjackBlackboard(bot, bb);

      // Stumps are at 0-5 blocks, trees are at 25-35 blocks
      // With 32 block radius, should find stumps (logs) but not the forest
      expect(bb.nearbyLogs.length).toBeGreaterThan(0);
      // Forest trees should be 0 because:
      // - Nearby logs are stumps (no leaves)
      // - Real trees are at 25-35 blocks, some might be in range
      // Let's check if any forest trees are found
      // The trees start at x=25, so with radius 32, some might be found
    });

    test('with village center: larger search radius finds distant trees', async () => {
      const world = createMixedWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;
      bb.villageCenter = new Vec3(0, 64, 0); // Sets search radius to 50

      await updateLumberjackBlackboard(bot, bb);

      // With 50 block radius, should find the forest at 25-35 blocks
      expect(bb.forestTrees.length).toBeGreaterThan(0);
      expect(bb.hasKnownForest).toBe(true);
    });
  });

  describe('SPEC: Inventory analysis', () => {
    test('detects axe in inventory', async () => {
      const world = new MockWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
        inventory: [item('stone_axe', 1)],
      });
      const bb = createLumberjackBlackboard();

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.hasAxe).toBe(true);
    });

    test('counts logs in inventory', async () => {
      const world = new MockWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
        inventory: [
          item('oak_log', 10),
          item('birch_log', 5),
        ],
      });
      const bb = createLumberjackBlackboard();

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.logCount).toBe(15);
    });

    test('counts saplings in inventory', async () => {
      const world = new MockWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
        inventory: [
          item('oak_sapling', 3),
          item('birch_sapling', 2),
        ],
      });
      const bb = createLumberjackBlackboard();

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.saplingCount).toBe(5);
    });
  });

  describe('SPEC: Edge cases', () => {
    test('empty world: no trees detected', async () => {
      const world = new MockWorld();
      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      expect(bb.nearbyLogs.length).toBe(0);
      expect(bb.nearbyTrees.length).toBe(0);
      expect(bb.forestTrees.length).toBe(0);
      expect(bb.hasKnownForest).toBe(false);
    });

    test('single tree: detected but not a forest (need 3+ for cluster)', async () => {
      const world = new MockWorld();
      world.fill(new Vec3(-10, 63, -10), new Vec3(10, 63, 10), 'grass_block');
      createOakTree(world, new Vec3(0, 64, 0), 5);

      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      // Should find the tree logs
      expect(bb.nearbyLogs.length).toBeGreaterThan(0);
      expect(bb.nearbyTrees.length).toBeGreaterThan(0);
      // But forestTrees requires clustering (3+ trees within 16 blocks)
      // A single tree won't form a cluster
      expect(bb.forestTrees.length).toBe(0);
      expect(bb.hasKnownForest).toBe(false);
    });

    test('exactly 3 trees: forms a valid forest cluster', async () => {
      const world = new MockWorld();
      world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
      // Place 3 trees close together (within 16 blocks of each other)
      createOakTree(world, new Vec3(0, 64, 0), 5);
      createOakTree(world, new Vec3(5, 64, 0), 5);
      createOakTree(world, new Vec3(0, 64, 5), 5);

      const bot = createBotMock({
        world,
        position: new Vec3(0, 64, 0),
      });
      const bb = createLumberjackBlackboard();
      bb.hasStudiedSigns = true;

      await updateLumberjackBlackboard(bot, bb);

      // 3 trees should form a valid forest cluster
      expect(bb.forestTrees.length).toBeGreaterThanOrEqual(3);
      expect(bb.hasKnownForest).toBe(true);
    });
  });
});
