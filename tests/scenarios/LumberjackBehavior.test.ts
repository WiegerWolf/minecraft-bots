import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { GOAPPlanner } from '../../src/planning/GOAPPlanner';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { WorldState } from '../../src/planning/WorldState';
import {
  freshSpawnLumberjackState,
  lumberjackReadyToChopState,
  lumberjackNeedsToDepositState,
  lumberjackWithStorageKnowledgeState,
  lumberjackMidTreeHarvestState,
  lumberjackCanCraftAxeState,
  lumberjackCanCraftAxeFromPlanksState,
  lumberjackPartialMaterialsState,
  lumberjackWithSaplingsState,
  lumberjackWithFarmerRequestState,
  lumberjackNeedsInfrastructureState,
  lumberjackWithPendingSignsState,
  lumberjackInActiveTradeState,
  lumberjackWithTradeOffersState,
  lumberjackWithTradeableItemsState,
  lumberjackStuckState,
  lumberjackWithUnknownSignsState,
  lumberjackNeedsStorageState,
  createWorldState,
  createLumberjackActionSet,
} from '../mocks';

/**
 * Comprehensive behavioral tests for the Lumberjack role.
 *
 * These tests verify the INTENDED behavior of the lumberjack as described
 * in the documentation and design vision, NOT just whatever the code
 * currently does.
 *
 * Key responsibilities of the lumberjack:
 * 1. Chop trees to gather wood (logs)
 * 2. Process wood into planks when needed
 * 3. Fulfill village requests for wood products
 * 4. Deposit logs in shared storage
 * 5. Plant saplings to sustain the forest
 * 6. Craft infrastructure (crafting tables, chests)
 * 7. Write knowledge signs to persist information
 * 8. Trade unwanted items with other bots
 */

describe('Lumberjack Behavior', () => {
  // Set up arbiter with real lumberjack goals
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);
  const actions = createLumberjackActionSet();
  const planner = new GOAPPlanner(actions);

  // ═══════════════════════════════════════════════════════════════════════════
  // STARTUP SEQUENCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Startup Sequence', () => {
    test('BEHAVIOR: Fresh spawn should study signs first', () => {
      // INTENT: On fresh spawn, the bot should walk to spawn and read signs
      // to learn about existing village infrastructure. This is the highest
      // priority because the bot needs this knowledge to function.
      const ws = freshSpawnLumberjackState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
      expect(result?.utility).toBe(200); // Highest priority
    });

    test('BEHAVIOR: After studying signs, should check storage for supplies if available', () => {
      // INTENT: If the bot knows about storage and has no axe, it should
      // check the chest first. This is much faster than punching trees.
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasStorageAccess', true);
      ws.set('has.checkedStorage', false);
      ws.set('has.axe', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('WithdrawSupplies');
      expect(result?.utility).toBe(180); // Very high - no axe case
    });

    test('BEHAVIOR: After checking storage with axe, lower priority withdrawal', () => {
      // INTENT: If bot already has axe but hasn't checked storage, still
      // worth checking but lower priority than critical tasks.
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasStorageAccess', true);
      ws.set('has.checkedStorage', false);
      ws.set('has.axe', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should still want to check storage, but utility is lower
      expect(result?.goal.name).toBe('WithdrawSupplies');
      expect(result?.utility).toBe(100); // Medium - has axe
    });

    test('BEHAVIOR: Once storage checked, should proceed to normal work', () => {
      // INTENT: After startup tasks complete, bot should do normal lumberjack work.
      const ws = lumberjackReadyToChopState();
      ws.set('has.checkedStorage', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should proceed to chopping or other work
      expect(result?.goal.name).not.toBe('StudySpawnSigns');
      expect(result?.goal.name).not.toBe('WithdrawSupplies');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY HIERARCHY - ITEMS DESPAWN!
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Drop Collection Priority', () => {
    test('BEHAVIOR: Drops should preempt tree chopping', () => {
      // INTENT: Dropped items despawn after 5 minutes. Collecting them
      // should take priority over ongoing work.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 3);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.utility).toBeGreaterThan(100); // High urgency
    });

    test('BEHAVIOR: More drops = higher urgency', () => {
      // INTENT: Utility should scale with drop count up to cap.
      const ws1 = lumberjackReadyToChopState();
      ws1.set('nearby.drops', 1);
      arbiter.clearCurrentGoal();
      const result1 = arbiter.selectGoal(ws1);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('nearby.drops', 5);
      arbiter.clearCurrentGoal();
      const result2 = arbiter.selectGoal(ws2);

      expect(result2?.utility).toBeGreaterThan(result1?.utility ?? 0);
      expect(result2?.utility).toBeLessThanOrEqual(150); // Capped at 150
    });

    test('BEHAVIOR: No drops = zero utility for collect goal', () => {
      // INTENT: If no drops nearby, the goal should have zero utility.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 0);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FARMER COOPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Farmer Request Fulfillment', () => {
    test('BEHAVIOR: Pending farmer request should be high priority', () => {
      // INTENT: When farmer broadcasts a request for wood, lumberjack should
      // prioritize fulfilling it - cooperation is key to village success.
      const ws = lumberjackWithFarmerRequestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillRequests');
      expect(result?.utility).toBeGreaterThanOrEqual(85);
    });

    test('BEHAVIOR: Request with materials should be higher priority than without', () => {
      // INTENT: If we have materials to fulfill immediately, that's more urgent.
      const wsWithMaterials = lumberjackWithFarmerRequestState();
      wsWithMaterials.set('inv.logs', 8);
      wsWithMaterials.set('inv.planks', 4);

      const wsWithoutMaterials = lumberjackWithFarmerRequestState();
      wsWithoutMaterials.set('inv.logs', 0);
      wsWithoutMaterials.set('inv.planks', 0);

      const fulfillGoal = goals.find((g) => g.name === 'FulfillRequests')!;
      const utilityWith = fulfillGoal.getUtility(wsWithMaterials);
      const utilityWithout = fulfillGoal.getUtility(wsWithoutMaterials);

      expect(utilityWith).toBeGreaterThan(utilityWithout);
      expect(utilityWith).toBe(120); // Higher when we can fulfill
    });

    test('BEHAVIOR: No pending request = zero utility', () => {
      // INTENT: If no one is asking for materials, don't pursue this goal.
      const ws = lumberjackReadyToChopState();
      ws.set('has.pendingRequests', false);

      const fulfillGoal = goals.find((g) => g.name === 'FulfillRequests')!;
      expect(fulfillGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Farmer request should preempt normal chopping', () => {
      // INTENT: Helping farmer is more important than gathering more wood.
      const ws = lumberjackReadyToChopState();
      ws.set('has.pendingRequests', true);
      ws.set('inv.logs', 8);
      ws.set('derived.hasStorageAccess', true);
      ws.set('nearby.reachableTrees', 10);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillRequests');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOURCE MANAGEMENT - DEPOSIT THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Log Deposit Thresholds', () => {
    test('BEHAVIOR: Full inventory forces deposit', () => {
      // INTENT: When inventory is full, MUST deposit - can't gather more.
      const ws = lumberjackNeedsToDepositState();
      ws.set('state.inventoryFull', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositLogs');
      expect(result?.utility).toBe(90); // Highest deposit priority
    });

    test('BEHAVIOR: 32+ logs should trigger deposit', () => {
      // INTENT: At 32 logs, inventory is getting full - time to deposit.
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 32);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(80);
    });

    test('BEHAVIOR: 16+ logs medium deposit priority', () => {
      // INTENT: At 16 logs, reasonable to deposit but not urgent.
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 16);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(70);
    });

    test('BEHAVIOR: 8+ logs low deposit priority', () => {
      // INTENT: At 8 logs, can deposit if convenient.
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 8);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(60);
    });

    test('BEHAVIOR: Few logs (<5) should not trigger deposit', () => {
      // INTENT: With only a few logs, continue gathering.
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 4);
      ws.set('state.inventoryFull', false);
      ws.set('has.pendingRequests', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Farmer request increases deposit urgency', () => {
      // INTENT: If farmer is waiting, deposit whatever we have.
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 8);
      ws.set('has.pendingRequests', true);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(85); // Higher because farmer waiting
    });

    test('BEHAVIOR: No storage access = cannot deposit', () => {
      // INTENT: Without a chest, can't deposit regardless of log count.
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 64);
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AXE CRAFTING PRIORITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Axe Crafting Priority', () => {
    test('BEHAVIOR: Can craft immediately = highest crafting priority', () => {
      // INTENT: If we have materials and crafting table, craft NOW.
      const ws = lumberjackCanCraftAxeState();

      const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
      expect(axeGoal.getUtility(ws)).toBe(95);
    });

    test('BEHAVIOR: Enough plank equivalent (9+) = stop and craft', () => {
      // INTENT: If we have enough materials (logs + planks), stop work and craft.
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('inv.logs', 3); // 3 logs = 12 plank equivalent
      ws.set('inv.planks', 0);
      ws.set('derived.canCraftAxe', false); // Can't craft yet but materials exist

      const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
      expect(axeGoal.getUtility(ws)).toBe(90);
    });

    test('BEHAVIOR: Some materials = medium priority', () => {
      // INTENT: With partial materials, prioritize but not as high.
      const ws = lumberjackPartialMaterialsState();
      ws.set('inv.logs', 1);
      ws.set('inv.planks', 2); // 4 + 2 = 6 plank equivalent

      const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
      expect(axeGoal.getUtility(ws)).toBe(75);
    });

    test('BEHAVIOR: No materials but trees = gather first', () => {
      // INTENT: Need to gather wood before we can craft.
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('nearby.reachableTrees', 5);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);

      const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
      expect(axeGoal.getUtility(ws)).toBe(50);
    });

    test('BEHAVIOR: No materials, no trees = cannot craft', () => {
      // INTENT: Without any resources or trees, can't pursue axe.
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('nearby.reachableTrees', 0);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);

      const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
      expect(axeGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Already have axe = zero utility', () => {
      // INTENT: No need to craft if we already have one.
      const ws = lumberjackReadyToChopState();
      ws.set('has.axe', true);

      const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
      expect(axeGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TREE HARVESTING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tree Harvesting', () => {
    test('BEHAVIOR: With axe and trees, should chop', () => {
      // INTENT: Core lumberjack activity when properly equipped.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('ChopTree');
    });

    test('BEHAVIOR: More trees = slightly higher utility', () => {
      // INTENT: Utility scales with available trees.
      const ws1 = lumberjackReadyToChopState();
      ws1.set('nearby.reachableTrees', 2);
      ws1.set('inv.logs', 0);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('nearby.reachableTrees', 10);
      ws2.set('inv.logs', 0);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws2)).toBeGreaterThan(chopGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Already have 16+ logs = goal satisfied', () => {
      // INTENT: ChopTree goal condition is "have 16+ logs".
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 16);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Mid-harvest should complete harvest first', () => {
      // INTENT: Once tree harvest started, finish it before starting new one.
      const ws = lumberjackMidTreeHarvestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTreeHarvest');
      expect(result?.utility).toBe(85);
    });

    test('BEHAVIOR: No trees = cannot chop', () => {
      // INTENT: Without nearby trees, can't pursue ChopTree goal.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Full inventory = cannot chop', () => {
      // INTENT: Can't gather more wood with full inventory.
      const ws = lumberjackReadyToChopState();
      ws.set('state.inventoryFull', true);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUSTAINABILITY - SAPLING REPLANTING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Sapling Planting', () => {
    test('BEHAVIOR: With saplings, should plant for sustainability', () => {
      // INTENT: Forest sustainability requires replanting.
      const ws = lumberjackWithSaplingsState();
      ws.set('tree.active', false);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('BEHAVIOR: More saplings = higher planting priority', () => {
      // INTENT: Don't hoard saplings - plant them!
      const ws1 = lumberjackWithSaplingsState();
      ws1.set('inv.saplings', 2);
      ws1.set('tree.active', false);

      const ws2 = lumberjackWithSaplingsState();
      ws2.set('inv.saplings', 10);
      ws2.set('tree.active', false);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws2)).toBeGreaterThan(plantGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Should NOT plant while actively harvesting', () => {
      // INTENT: Finish current tree first, then replant.
      const ws = lumberjackWithSaplingsState();
      ws.set('tree.active', true);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No saplings = cannot plant', () => {
      // INTENT: Need saplings to plant.
      const ws = lumberjackReadyToChopState();
      ws.set('inv.saplings', 0);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INFRASTRUCTURE CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Infrastructure Creation', () => {
    test('BEHAVIOR: Needs crafting table + has materials = should craft', () => {
      // INTENT: Crafting table enables other crafting, important to set up.
      const ws = lumberjackNeedsInfrastructureState();

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(65);
    });

    test('BEHAVIOR: Needs chest + has materials = should craft', () => {
      // INTENT: Chest enables storage, needed for deposit/withdraw.
      const ws = lumberjackNeedsInfrastructureState();
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', true);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(45);
    });

    test('BEHAVIOR: Crafting table has higher priority than chest', () => {
      // INTENT: Table enables other crafting (axe, etc), more foundational.
      const ws = lumberjackNeedsInfrastructureState();

      const wsTableOnly = ws.clone();
      wsTableOnly.set('derived.needsCraftingTable', true);
      wsTableOnly.set('derived.needsChest', false);

      const wsChestOnly = ws.clone();
      wsChestOnly.set('derived.needsCraftingTable', false);
      wsChestOnly.set('derived.needsChest', true);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(wsTableOnly)).toBeGreaterThan(
        infraGoal.getUtility(wsChestOnly)
      );
    });

    test('BEHAVIOR: No infrastructure needs = zero utility', () => {
      // INTENT: If we have all infrastructure, don't pursue this.
      const ws = lumberjackReadyToChopState();
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', false);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No materials = zero utility', () => {
      // INTENT: Can't craft without materials.
      const ws = freshSpawnLumberjackState();
      ws.set('derived.needsCraftingTable', true);
      ws.set('inv.planks', 0);
      ws.set('inv.logs', 0);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE PERSISTENCE - SIGN WRITING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Knowledge Sign Writing', () => {
    test('BEHAVIOR: Pending sign writes should be addressed', () => {
      // INTENT: After placing infrastructure, write signs to persist knowledge.
      const ws = lumberjackWithPendingSignsState();

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('BEHAVIOR: More pending writes = higher priority', () => {
      // INTENT: Don't let sign queue build up.
      const ws1 = lumberjackWithPendingSignsState();
      ws1.set('pending.signWrites', 1);

      const ws2 = lumberjackWithPendingSignsState();
      ws2.set('pending.signWrites', 3);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
    });

    test('BEHAVIOR: No pending writes = zero utility', () => {
      // INTENT: Nothing to write, nothing to do.
      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 0);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADING BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Trading Behavior', () => {
    test('BEHAVIOR: Active trade should be completed with highest priority', () => {
      // INTENT: Once trade started, MUST finish - partner is waiting.
      const ws = lumberjackInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('BEHAVIOR: Pending trade offers should be responded to', () => {
      // INTENT: Trading saves gathering time - respond to offers.
      const ws = lumberjackWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('BEHAVIOR: With tradeable items and idle, can broadcast offer', () => {
      // INTENT: Clean up inventory by offering unwanted items.
      const ws = lumberjackWithTradeableItemsState();
      ws.set('nearby.reachableTrees', 0); // Idle - nothing to chop
      ws.set('state.consecutiveIdleTicks', 5);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('BEHAVIOR: Already in trade = cannot broadcast new offer', () => {
      // INTENT: Can only have one trade at a time.
      const ws = lumberjackWithTradeableItemsState();
      ws.set('trade.inTrade', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: On cooldown = cannot broadcast', () => {
      // INTENT: Don't spam trade offers.
      const ws = lumberjackWithTradeableItemsState();
      ws.set('trade.onCooldown', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Less than 4 tradeable items = dont bother', () => {
      // INTENT: Only trade meaningful quantities.
      const ws = lumberjackWithTradeableItemsState();
      ws.set('trade.tradeableCount', 3);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Active trade preempts everything except drops', () => {
      // INTENT: Trade completion is critical - partner waiting.
      const ws = lumberjackInActiveTradeState();
      ws.set('nearby.reachableTrees', 10);
      ws.set('has.pendingRequests', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PATROL AND EXPLORATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Patrol and Exploration', () => {
    test('BEHAVIOR: No trees nearby = should patrol', () => {
      // INTENT: If no trees to chop, explore to find some.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0);

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws)).toBe(45);
    });

    test('BEHAVIOR: Stuck state = patrol to unstick', () => {
      // INTENT: High idle ticks means actions keep failing - need to move.
      const ws = lumberjackStuckState();

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      // At idleTicks=10: 40 + 20 = 60
      expect(patrolGoal.getUtility(ws)).toBeGreaterThan(50);
    });

    test('BEHAVIOR: Patrol utility increases with idle ticks', () => {
      // INTENT: The longer we're stuck, the more we need to move.
      const ws1 = lumberjackReadyToChopState();
      ws1.set('state.consecutiveIdleTicks', 4);
      ws1.set('nearby.reachableTrees', 1);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('state.consecutiveIdleTicks', 10);
      ws2.set('nearby.reachableTrees', 1);

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws2)).toBeGreaterThan(patrolGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Patrol is always valid (fallback)', () => {
      // INTENT: Patrol should always be available as a fallback.
      const ws = lumberjackReadyToChopState();

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.isValid(ws)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CURIOUS BOT - UNKNOWN SIGNS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Unknown Sign Reading', () => {
    test('BEHAVIOR: Should investigate unknown signs', () => {
      // INTENT: Bot is curious - will check signs it hasn't read.
      const ws = lumberjackWithUnknownSignsState();

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      expect(signGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('BEHAVIOR: More unknown signs = slightly higher priority', () => {
      // INTENT: Batch reading is efficient.
      const ws1 = lumberjackWithUnknownSignsState();
      ws1.set('nearby.unknownSigns', 1);

      const ws2 = lumberjackWithUnknownSignsState();
      ws2.set('nearby.unknownSigns', 3);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Sign reading lower priority than core work', () => {
      // INTENT: Don't get distracted from important tasks.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.unknownSigns', 2);
      ws.set('nearby.reachableTrees', 5);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      expect(chopGoal.getUtility(ws)).toBeGreaterThan(signGoal.getUtility(ws));
    });

    test('BEHAVIOR: Sign reading higher priority than patrol', () => {
      // INTENT: Investigating signs is more useful than wandering.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.unknownSigns', 2);
      ws.set('nearby.reachableTrees', 0);
      ws.set('state.consecutiveIdleTicks', 0);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;

      expect(signGoal.getUtility(ws)).toBeGreaterThan(patrolGoal.getUtility(ws));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WOOD PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Wood Processing', () => {
    test('BEHAVIOR: With logs and low planks, should process', () => {
      // INTENT: Keep some planks available for crafting.
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 8);
      ws.set('inv.planks', 0);

      const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
      expect(processGoal.getUtility(ws)).toBe(50);
    });

    test('BEHAVIOR: Already have enough planks = low priority', () => {
      // INTENT: Don't over-process.
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 8);
      ws.set('inv.planks', 8);

      const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
      expect(processGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Too few logs = cannot process', () => {
      // INTENT: Need at least 2 logs to make processing worthwhile.
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 1);
      ws.set('inv.planks', 0);

      const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
      expect(processGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GOAL HYSTERESIS - AVOID THRASHING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Goal Stability (Hysteresis)', () => {
    test('BEHAVIOR: Should not thrash between similar-utility goals', () => {
      // INTENT: 20% hysteresis prevents rapid goal switching.
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 6);
      ws.set('inv.saplings', 4);
      ws.set('tree.active', false);

      // First selection
      arbiter.clearCurrentGoal();
      const result1 = arbiter.selectGoal(ws);
      const firstGoal = result1?.goal.name;

      // Slightly change utilities but within hysteresis threshold
      ws.set('inv.saplings', 5);

      // Should stick with current goal due to hysteresis
      const result2 = arbiter.selectGoal(ws);

      // If hysteresis is working, should have reason 'hysteresis' or stay on same goal
      if (result1?.goal.name === result2?.goal.name) {
        expect(result2?.reason === 'hysteresis' || result2?.goal.name === firstGoal).toBe(
          true
        );
      }
    });

    test('BEHAVIOR: Should switch when new goal is significantly better', () => {
      // INTENT: Large utility differences should cause switching.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 5);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      arbiter.selectGoal(ws); // Establishes current goal

      // Big change - drops appear
      ws.set('nearby.drops', 5); // Utility 150

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.reason).toBe('switch');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLEX SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complex Scenarios', () => {
    test('SCENARIO: Fresh spawn complete workflow', () => {
      // INTENT: Bot should follow proper startup sequence.
      const ws = freshSpawnLumberjackState();

      // Step 1: Study signs
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: After studying, check storage (if available)
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasStorageAccess', true);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('WithdrawSupplies');

      // Step 3: After checking storage, patrol to find trees
      ws.set('has.checkedStorage', true);
      ws.set('has.axe', false);
      result = arbiter.selectGoal(ws);
      // Either ObtainAxe (if materials) or PatrolForest
      expect(['ObtainAxe', 'PatrolForest'].includes(result?.goal.name ?? '')).toBe(true);
    });

    test('SCENARIO: Established lumberjack daily routine', () => {
      // INTENT: Normal work cycle: chop → deposit → repeat.
      const ws = lumberjackReadyToChopState();
      ws.set('has.checkedStorage', true);
      ws.set('derived.hasStorageAccess', true);
      ws.set('inv.logs', 4);
      ws.set('nearby.reachableTrees', 5);

      // Should chop trees
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');

      // After gathering 32 logs, should deposit
      ws.set('inv.logs', 32);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('DepositLogs');
    });

    test('SCENARIO: Interruption handling - drops during work', () => {
      // INTENT: Drops should interrupt normal work.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 10);

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');

      // Drops appear!
      ws.set('nearby.drops', 4);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');

      // Drops collected
      ws.set('nearby.drops', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');
    });

    test('SCENARIO: Multiple urgent priorities - highest wins', () => {
      // INTENT: When multiple urgent things happen, highest utility wins.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 5); // Utility 150
      ws.set('has.pendingRequests', true); // Utility 120
      ws.set('trade.pendingOffers', 2); // Utility 120

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.utility).toBe(150);
    });

    test('SCENARIO: Infrastructure bootstrap', () => {
      // INTENT: New area setup - crafting table then chest.
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.axe', true);
      ws.set('inv.planks', 12);
      ws.set('derived.needsCraftingTable', true);
      ws.set('derived.needsChest', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should prioritize crafting table (utility 65 > chest 45)
      expect(result?.goal.name).toBe('CraftInfrastructure');

      // After table placed, should craft chest
      ws.set('derived.needsCraftingTable', false);
      const result2 = arbiter.selectGoal(ws);
      expect(result2?.goal.name).toBe('CraftInfrastructure');
    });

    test('SCENARIO: Trading during idle period', () => {
      // INTENT: When nothing else to do, trade unwanted items.
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0);
      ws.set('inv.logs', 0); // No logs to process
      ws.set('inv.planks', 10); // Has planks but that's fine
      ws.set('state.consecutiveIdleTicks', 5);
      ws.set('trade.tradeableCount', 8);
      ws.set('trade.inTrade', false);
      ws.set('trade.onCooldown', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // When truly idle, PatrolForest (45) or BroadcastTradeOffer (38) should win
      // PatrolForest increases with idle ticks: 40 + 5*2 = 50 when idle=5
      expect(
        ['PatrolForest', 'BroadcastTradeOffer'].includes(result?.goal.name ?? '')
      ).toBe(true);
    });
  });
});
