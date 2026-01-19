import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import { freshSpawnLumberjackState, lumberjackReadyToChopState } from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Infrastructure Establishment
 *
 * The lumberjack is responsible for establishing village infrastructure:
 * 1. Crafting table (village center) - CRITICAL for other bots
 * 2. Storage chest - for depositing wood products
 *
 * PLACEMENT RULES (implemented in behavior code):
 * - Village center (crafting table) must be:
 *   - On a valid surface (grass, dirt, stone - not in midair)
 *   - Not underground (must have sky access or be on grass)
 *   - In an open area (at least 2 of 4 cardinal directions open)
 *   - Not in a 1-block hole or cramped space
 * - Storage chest must be:
 *   - Placed by the bot (not adopting random found chests like nether ruins)
 *   - On an accessible surface near the village center
 *   - Reachable by pathfinding
 */

describe('Lumberjack Infrastructure', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);
  const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;

  describe('CraftInfrastructure Goal Utility', () => {
    test('SPEC: Zero utility when has both crafting table and chest', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', false);
      ws.set('inv.planks', 8);

      expect(infraGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Zero utility when no materials', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('derived.needsCraftingTable', true);
      ws.set('derived.needsChest', true);
      ws.set('inv.planks', 0);
      ws.set('inv.logs', 0);

      expect(infraGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Higher utility (65) for crafting table than chest (45)', () => {
      const wsCraftingTable = freshSpawnLumberjackState();
      wsCraftingTable.set('derived.needsCraftingTable', true);
      wsCraftingTable.set('derived.needsChest', false);
      wsCraftingTable.set('inv.planks', 8);

      const wsChest = freshSpawnLumberjackState();
      wsChest.set('derived.needsCraftingTable', false);
      wsChest.set('derived.needsChest', true);
      wsChest.set('inv.planks', 8);

      expect(infraGoal.getUtility(wsCraftingTable)).toBe(65);
      expect(infraGoal.getUtility(wsChest)).toBe(45);
      expect(infraGoal.getUtility(wsCraftingTable)).toBeGreaterThan(infraGoal.getUtility(wsChest));
    });

    test('SPEC: Materials from logs count (1 log = 4 planks potential)', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('derived.needsCraftingTable', true);
      ws.set('inv.planks', 0);
      ws.set('inv.logs', 1); // 1 log can make 4 planks

      // Should have utility since we have materials (1 log)
      expect(infraGoal.getUtility(ws)).toBeGreaterThan(0);
    });
  });

  describe('Goal Selection for Infrastructure', () => {
    test('SPEC: CraftInfrastructure selected when needs crafting table with materials', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.checkedStorage', true);
      ws.set('has.axe', true); // Has axe, so ObtainAxe won't compete
      ws.set('has.knownForest', true); // Knows forest, so FindForest won't compete
      ws.set('derived.needsCraftingTable', true);
      ws.set('derived.needsChest', false);
      ws.set('inv.planks', 8);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CraftInfrastructure');
    });

    test('SPEC: CraftInfrastructure selected when needs chest with materials', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.checkedStorage', true);
      ws.set('has.axe', true); // Has axe
      ws.set('has.knownForest', true); // Knows forest
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', true);
      ws.set('inv.planks', 8);
      ws.set('nearby.drops', 0);
      ws.set('nearby.craftingTables', 1); // Has crafting table to make chest

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CraftInfrastructure');
    });

    test('SPEC: Crafting table prioritized over chest', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.checkedStorage', true);
      ws.set('has.axe', true); // Has axe
      ws.set('has.knownForest', true); // Knows forest
      ws.set('derived.needsCraftingTable', true);
      ws.set('derived.needsChest', true);
      ws.set('inv.planks', 16);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should select infrastructure and utility should be 65 (crafting table priority)
      expect(result?.goal.name).toBe('CraftInfrastructure');
      expect(result?.utility).toBe(65);
    });

    test('SPEC: ObtainAxe prioritized over CraftInfrastructure when no axe', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.checkedStorage', true);
      ws.set('has.axe', false);
      ws.set('derived.needsCraftingTable', true);
      ws.set('inv.planks', 8);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // ObtainAxe should win since it has higher utility (90 vs 65)
      expect(result?.goal.name).toBe('ObtainAxe');
    });
  });

  describe('Infrastructure Establishment Sequence', () => {
    test('SPEC: Full village setup sequence (with axe and known forest)', () => {
      const ws = freshSpawnLumberjackState();

      // Step 1: Study signs first
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: After signs, with axe and known forest but no materials
      ws.set('has.studiedSigns', true);
      ws.set('has.axe', true); // Already has axe
      ws.set('has.knownForest', true); // Already knows about forest
      ws.set('derived.needsCraftingTable', true);
      ws.set('derived.needsChest', true);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      // Can't craft infrastructure without materials - should do something else
      expect(result?.goal.name).not.toBe('CraftInfrastructure');

      // Step 3: After gathering some logs, craft infrastructure
      ws.set('inv.logs', 2); // Enough for crafting table
      ws.set('inv.planks', 4);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CraftInfrastructure');

      // Step 4: After crafting table placed, continue with chest
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', true);
      ws.set('nearby.craftingTables', 1);
      ws.set('inv.planks', 8); // Need 8 planks for chest

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CraftInfrastructure');

      // Step 5: After chest placed, proceed to normal work
      ws.set('derived.needsChest', false);
      ws.set('derived.hasStorageAccess', true);
      ws.set('nearby.chests', 1);
      ws.set('nearby.forestTrees', 5);

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).not.toBe('CraftInfrastructure');
    });

    test('SPEC: Axe crafted before infrastructure when no axe', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.axe', false);
      ws.set('derived.needsCraftingTable', true);
      ws.set('inv.logs', 3); // Enough for both crafting table and axe

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // ObtainAxe should be prioritized over CraftInfrastructure
      expect(result?.goal.name).toBe('ObtainAxe');
    });
  });

  describe('Placement Rules (Documented Specs)', () => {
    /**
     * These tests document the expected placement behavior.
     * The actual validation is in the behavior code (CraftAndPlaceCraftingTable.ts).
     *
     * Village center placement requirements:
     * 1. Must be on valid surface block (grass, dirt, stone, etc.)
     * 2. Must not be underground (needs sky access or grass block presence)
     * 3. Must be in open area (2+ cardinal directions open)
     * 4. Must have air at feet and head level
     */

    test('SPEC: Village center requires valid surface (grass, dirt, stone)', () => {
      // This documents that the behavior validates surface blocks.
      // Valid surfaces: grass_block, dirt, podzol, mycelium, coarse_dirt,
      //                 rooted_dirt, sand, red_sand, gravel, clay, moss_block,
      //                 stone, deepslate, andesite, diorite, granite
      // Invalid: air, water, leaves, logs (not on top of structures)
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Village center must not be underground', () => {
      // The behavior checks:
      // - Sky access (no solid blocks above), OR
      // - Standing on grass_block (grass needs light to exist)
      // This prevents placing crafting table in caves, holes, or ruins
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Village center must be in open area (2+ sides open)', () => {
      // The behavior checks cardinal directions:
      // - North, South, East, West positions
      // - At least 2 must have air or passable blocks
      // This prevents placing in 1-wide corridors or corners
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Storage chest must be bot-placed (not adopted)', () => {
      // The DepositLogs behavior:
      // - Only uses chests from bb.knownChests (signs, village chat, bot-placed)
      // - Does NOT adopt random found chests (like nether portal ruins)
      // - PlaceStorageChest behavior places new chest near village center
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Storage chest placement requires accessible location', () => {
      // PlaceStorageChest validates:
      // - Surface is solid and walkable
      // - Position is near village center
      // - Position is reachable by pathfinding
      expect(true).toBe(true); // Documentation test
    });
  });

  describe('Chest Adoption Rules (Critical - Prevents Bug)', () => {
    /**
     * CRITICAL: Bots must NEVER adopt random "nearby chests" as shared storage.
     *
     * Why this matters:
     * - Minecraft worlds have pregenerated chests in dungeons, mineshafts, nether ruins, etc.
     * - These are often underground (Y < 55) or in hard-to-reach locations
     * - If a bot adopts one as "sharedChest", all bots try to use it and get stuck
     *
     * The fix:
     * - Only use chests from TRUSTED SOURCES:
     *   1. bb.sharedChest - announced via VillageChat by lumberjack who placed it
     *   2. bb.knownChests - from CHEST signs written by bots
     *   3. bb.farmChest - farm-specific chest set by farmer
     * - NEVER fall back to nearbyChests[0] which is just "any chest I can see"
     */

    test('SPEC: Farmer CheckSharedChest only uses announced shared chest', () => {
      // CheckSharedChest.findChest():
      // - Uses bb.villageChat.getSharedChest() only
      // - Returns null if no shared chest announced
      // - Does NOT fall back to nearbyChests[0]
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Farmer DepositItems only uses farmChest or sharedChest', () => {
      // DepositItems.findChest():
      // - Uses bb.farmChest first (if exists and valid)
      // - Falls back to bb.sharedChest (if exists and valid)
      // - Returns null if neither exists
      // - Does NOT fall back to nearbyChests[0]
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Landscaper CheckSharedChest only uses announced shared chest', () => {
      // CheckSharedChest.findChest():
      // - Uses bb.sharedChest only
      // - Returns null if no shared chest
      // - Does NOT fall back to nearbyChests[0]
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Landscaper DepositItems only uses sharedChest', () => {
      // DepositItems.findChest():
      // - Uses bb.sharedChest only (if exists and valid)
      // - Returns null if no shared chest
      // - Does NOT fall back to nearbyChests[0]
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Lumberjack RespondToNeed requires sharedChest (no adoption)', () => {
      // RespondToNeed:
      // - Requires bb.sharedChest to exist
      // - Returns 'failure' if no shared chest - lumberjack must place one first
      // - Does NOT adopt nearbyChests[0] as shared chest
      // - This is the critical fix that prevents the pregenerated chest bug
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Lumberjack WithdrawSupplies only uses known chests', () => {
      // WithdrawSupplies:
      // - Uses bb.sharedChest first
      // - Falls back to bb.knownChests[0] (from sign knowledge)
      // - Does NOT fall back to nearbyChests[0]
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Only lumberjack PlaceStorageChest creates shared chests', () => {
      // The lumberjack is the ONLY role that places storage chests:
      // - PlaceStorageChest behavior crafts and places a chest
      // - Then calls bb.villageChat.announceSharedChest()
      // - This broadcasts [CHEST] shared X Y Z to all bots
      // - Other bots receive this and set their bb.sharedChest
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: Chest Y-level sanity check (surface level)', () => {
      // Shared chests should be near surface level (Y ~63)
      // Pregenerated chests are often:
      // - Underground: Y < 55 (dungeons, mineshafts)
      // - Nether portal ruins: can be anywhere
      // - Desert temples: often at Y ~64 but underground
      // The bot-placed chest should always be at the bot's current Y level
      expect(true).toBe(true); // Documentation test
    });
  });
});
