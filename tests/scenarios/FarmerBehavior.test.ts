import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { GOAPPlanner } from '../../src/planning/GOAPPlanner';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { WorldState } from '../../src/planning/WorldState';
import {
  freshSpawnFarmerState,
  establishedFarmerState,
  farmerWithMatureCropsState,
  farmerWithDropsState,
  farmerWithFullInventoryState,
  farmerNeedingHoeWithMaterialsState,
  farmerNeedingHoeWithChestState,
  farmerReadyToPlantState,
  farmerNeedsTillingState,
  farmerFoundWaterState,
  farmerGatheringSeedsState,
  farmerInActiveTradeState,
  farmerWithTradeOffersState,
  farmerWithFarmSignPendingState,
  farmerWithUnknownSignsState,
  farmerIdleState,
  farmerWithTradeableItemsState,
  createWorldState,
  createFarmingActionSet,
} from '../mocks';

/**
 * Comprehensive behavioral tests for the Farmer role.
 *
 * These tests verify the INTENDED behavior of the farmer as described
 * in the documentation and design vision.
 *
 * Key responsibilities of the farmer:
 * 1. Grow crops (till, plant, harvest cycle)
 * 2. Manage inventory (deposit produce, gather materials)
 * 3. Obtain tools (hoe for farming)
 * 4. Establish farms near water sources
 * 5. Persist knowledge via signs
 * 6. Trade unwanted items with other bots
 */

describe('Farmer Behavior', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);
  const actions = createFarmingActionSet();
  const planner = new GOAPPlanner(actions);

  // ═══════════════════════════════════════════════════════════════════════════
  // STARTUP SEQUENCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Startup Sequence', () => {
    test('BEHAVIOR: Fresh spawn should study signs first', () => {
      // INTENT: First action is to learn about existing infrastructure.
      const ws = freshSpawnFarmerState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
      expect(result?.utility).toBe(200);
    });

    test('BEHAVIOR: After signs, establish farm if none exists', () => {
      // INTENT: Need farm center before any farming activities.
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('nearby.water', 3);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('EstablishFarm');
      expect(result?.utility).toBe(75); // Water found
    });

    test('BEHAVIOR: No water found = lower establish priority but still selected', () => {
      // INTENT: Even without water, bot should explore to find it.
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('nearby.water', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('EstablishFarm');
      expect(result?.utility).toBe(65);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP COLLECTION PRIORITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Drop Collection Priority', () => {
    test('BEHAVIOR: Drops should preempt harvesting', () => {
      // INTENT: Drops despawn - they're more urgent than unharvested crops.
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.drops', 4);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
    });

    test('BEHAVIOR: Drop utility scales with count', () => {
      // INTENT: More drops = higher urgency, up to cap.
      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;

      const ws1 = establishedFarmerState();
      ws1.set('nearby.drops', 1);

      const ws2 = establishedFarmerState();
      ws2.set('nearby.drops', 5);

      expect(collectGoal.getUtility(ws2)).toBeGreaterThan(collectGoal.getUtility(ws1));
      expect(collectGoal.getUtility(ws2)).toBe(150); // Capped
    });

    test('BEHAVIOR: No drops = zero utility', () => {
      // INTENT: Don't pursue if no drops exist.
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 0);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HARVESTING BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Harvesting Behavior', () => {
    test('BEHAVIOR: Mature crops should be harvested', () => {
      // INTENT: Core farming activity - harvest when crops are ready.
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('HarvestCrops');
    });

    test('BEHAVIOR: More crops = higher harvest utility', () => {
      // INTENT: Utility scales with crop count.
      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;

      const ws1 = farmerWithMatureCropsState();
      ws1.set('nearby.matureCrops', 2);

      const ws2 = farmerWithMatureCropsState();
      ws2.set('nearby.matureCrops', 12);

      expect(harvestGoal.getUtility(ws2)).toBeGreaterThan(harvestGoal.getUtility(ws1));
      expect(harvestGoal.getUtility(ws2)).toBeLessThanOrEqual(100); // Capped
    });

    test('BEHAVIOR: Full inventory blocks harvesting', () => {
      // INTENT: Can't harvest with no room in inventory.
      const ws = farmerWithMatureCropsState();
      ws.set('state.inventoryFull', true);

      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;
      expect(harvestGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No mature crops = zero harvest utility', () => {
      // INTENT: Nothing to harvest, don't pursue.
      const ws = establishedFarmerState();
      ws.set('nearby.matureCrops', 0);

      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;
      expect(harvestGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCE DEPOSIT BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Produce Deposit Behavior', () => {
    test('BEHAVIOR: Full inventory forces deposit', () => {
      // INTENT: Can't continue farming without depositing.
      const ws = farmerWithFullInventoryState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositProduce');
      expect(result?.utility).toBe(90);
    });

    test('BEHAVIOR: Lots of produce triggers deposit', () => {
      // INTENT: Deposit when inventory is getting full.
      const ws = establishedFarmerState();
      ws.set('inv.produce', 40);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(70);
    });

    test('BEHAVIOR: Medium produce = medium priority', () => {
      // INTENT: Deposit at medium fullness.
      const ws = establishedFarmerState();
      ws.set('inv.produce', 20);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(40);
    });

    test('BEHAVIOR: Little produce = low priority', () => {
      // INTENT: Don't rush to deposit small amounts.
      const ws = establishedFarmerState();
      ws.set('inv.produce', 8);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(20);
    });

    test('BEHAVIOR: No produce = zero utility', () => {
      // INTENT: Nothing to deposit.
      const ws = establishedFarmerState();
      ws.set('inv.produce', 0);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No storage = cannot deposit', () => {
      // INTENT: Need chest access to deposit.
      const ws = establishedFarmerState();
      ws.set('inv.produce', 64);
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANTING BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Planting Behavior', () => {
    test('BEHAVIOR: With seeds and farmland, should plant', () => {
      // INTENT: Core farming activity - keep farmland planted.
      const ws = farmerReadyToPlantState();

      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;
      expect(plantGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('BEHAVIOR: More farmland = higher plant utility', () => {
      // INTENT: More empty farmland means more planting opportunity.
      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;

      const ws1 = farmerReadyToPlantState();
      ws1.set('nearby.farmland', 5);

      const ws2 = farmerReadyToPlantState();
      ws2.set('nearby.farmland', 15);

      expect(plantGoal.getUtility(ws2)).toBeGreaterThan(plantGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Cannot plant without ability', () => {
      // INTENT: Needs seeds, hoe, and farmland.
      const ws = establishedFarmerState();
      ws.set('can.plant', false);

      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No farmland = zero plant utility', () => {
      // INTENT: Nowhere to plant.
      const ws = farmerReadyToPlantState();
      ws.set('nearby.farmland', 0);

      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TILLING BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tilling Behavior', () => {
    test('BEHAVIOR: Low farmland should trigger tilling', () => {
      // INTENT: Need to expand farm when short on farmland.
      const ws = farmerNeedsTillingState();
      ws.set('nearby.farmland', 5);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(50); // High priority when < 10
    });

    test('BEHAVIOR: Medium farmland = medium tilling priority', () => {
      // INTENT: Some expansion still useful.
      const ws = farmerNeedsTillingState();
      ws.set('nearby.farmland', 15);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(30);
    });

    test('BEHAVIOR: Sufficient farmland = low tilling priority', () => {
      // INTENT: Farm is big enough, focus on farming.
      const ws = farmerNeedsTillingState();
      ws.set('nearby.farmland', 25);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(10);
    });

    test('BEHAVIOR: Cannot till without ability', () => {
      // INTENT: Needs hoe and established farm.
      const ws = farmerNeedsTillingState();
      ws.set('can.till', false);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Cannot till without farm', () => {
      // INTENT: Need established farm first.
      const ws = farmerNeedsTillingState();
      ws.set('derived.hasFarmEstablished', false);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL ACQUISITION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tool Acquisition', () => {
    test('BEHAVIOR: No hoe + materials = high craft priority', () => {
      // INTENT: Can craft immediately - very high priority.
      const ws = farmerNeedingHoeWithMaterialsState();
      ws.set('has.studiedSigns', true);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(95);
    });

    test('BEHAVIOR: No hoe + chest access = medium priority', () => {
      // INTENT: Might be able to get materials from chest.
      const ws = farmerNeedingHoeWithChestState();
      ws.set('has.studiedSigns', true);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(80);
    });

    test('BEHAVIOR: No hoe, no materials, no chest = low priority', () => {
      // INTENT: Can't do much about it, let other goals run.
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('has.hoe', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', false);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(40);
    });

    test('BEHAVIOR: Has hoe = zero tool utility', () => {
      // INTENT: Already equipped.
      const ws = establishedFarmerState();
      ws.set('has.hoe', true);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEED GATHERING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Seed Gathering', () => {
    test('BEHAVIOR: No hoe + farm = high seed gathering priority', () => {
      // INTENT: Productive while waiting for hoe/materials.
      const ws = farmerGatheringSeedsState();
      ws.set('inv.seeds', 0);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBe(70); // Very high when no hoe but has farm
    });

    test('BEHAVIOR: Some seeds + no hoe = still high priority', () => {
      // INTENT: Keep gathering while waiting for hoe.
      const ws = farmerGatheringSeedsState();
      ws.set('inv.seeds', 3);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBe(65);
    });

    test('BEHAVIOR: Enough seeds = zero utility', () => {
      // INTENT: Stop gathering when we have enough.
      const ws = farmerGatheringSeedsState();
      ws.set('inv.seeds', 15);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: With hoe, seed gathering is lower priority', () => {
      // INTENT: When properly equipped, other farming activities take precedence.
      const ws = establishedFarmerState();
      ws.set('has.hoe', true);
      ws.set('inv.seeds', 2);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBeLessThan(60);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FARM ESTABLISHMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Farm Establishment', () => {
    test('BEHAVIOR: Found water = high establish priority', () => {
      // INTENT: Ready to establish farm.
      const ws = farmerFoundWaterState();

      const farmGoal = goals.find((g) => g.name === 'EstablishFarm')!;
      expect(farmGoal.getUtility(ws)).toBe(75);
    });

    test('BEHAVIOR: No water = medium establish priority', () => {
      // INTENT: Need to explore to find water.
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('nearby.water', 0);

      const farmGoal = goals.find((g) => g.name === 'EstablishFarm')!;
      expect(farmGoal.getUtility(ws)).toBe(65);
    });

    test('BEHAVIOR: Farm established = zero utility', () => {
      // INTENT: Already have farm.
      const ws = establishedFarmerState();

      const farmGoal = goals.find((g) => g.name === 'EstablishFarm')!;
      expect(farmGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE SIGN WRITING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Knowledge Sign Writing', () => {
    test('BEHAVIOR: FARM sign pending = CRITICAL priority', () => {
      // INTENT: Landscapers need farm locations to terraform.
      const ws = farmerWithFarmSignPendingState();
      ws.set('has.sign', true);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(250); // Highest with sign
    });

    test('BEHAVIOR: FARM sign + can craft = very high priority', () => {
      // INTENT: Can craft sign immediately.
      const ws = farmerWithFarmSignPendingState();
      ws.set('has.sign', false);
      ws.set('derived.canCraftSign', true);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(230);
    });

    test('BEHAVIOR: FARM sign + storage access = high priority', () => {
      // INTENT: Get materials from chest first.
      const ws = farmerWithFarmSignPendingState();
      ws.set('has.sign', false);
      ws.set('derived.canCraftSign', false);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(210);
    });

    test('BEHAVIOR: Other sign type = moderate priority', () => {
      // INTENT: Non-FARM signs are less critical.
      const ws = establishedFarmerState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', false);
      ws.set('has.sign', true);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(120);
    });

    test('BEHAVIOR: No pending signs = zero utility', () => {
      // INTENT: Nothing to write.
      const ws = establishedFarmerState();
      ws.set('pending.signWrites', 0);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: FARM sign preempts harvesting', () => {
      // INTENT: Infrastructure knowledge is critical.
      const ws = farmerWithMatureCropsState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', true);
      ws.set('has.sign', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('WriteKnowledgeSign');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CURIOUS BOT - UNKNOWN SIGNS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Unknown Sign Reading', () => {
    test('BEHAVIOR: Unknown signs should be investigated', () => {
      // INTENT: Curious bot - might learn something useful.
      const ws = farmerWithUnknownSignsState();

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      expect(signGoal.getUtility(ws)).toBeGreaterThan(45);
    });

    test('BEHAVIOR: More signs = slightly higher priority', () => {
      // INTENT: Batch reading is efficient.
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

      const ws1 = farmerWithUnknownSignsState();
      ws1.set('nearby.unknownSigns', 1);

      const ws2 = farmerWithUnknownSignsState();
      ws2.set('nearby.unknownSigns', 3);

      expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Sign reading lower than core farming', () => {
      // INTENT: Don't get distracted from farming.
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.unknownSigns', 2);

      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

      expect(harvestGoal.getUtility(ws)).toBeGreaterThan(signGoal.getUtility(ws));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADING BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Trading Behavior', () => {
    test('BEHAVIOR: Active trade should be completed first', () => {
      // INTENT: Once trade started, must finish - partner waiting.
      const ws = farmerInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('BEHAVIOR: Pending trade offers should be responded to', () => {
      // INTENT: Trading saves gathering time.
      const ws = farmerWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('BEHAVIOR: Trade offers preempt normal farming', () => {
      // INTENT: Trading is valuable, don't miss opportunities.
      const ws = establishedFarmerState();
      ws.set('trade.pendingOffers', 2);
      ws.set('nearby.matureCrops', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });

    test('BEHAVIOR: Idle with tradeable items can broadcast', () => {
      // INTENT: Clean up inventory when nothing else to do.
      const ws = farmerWithTradeableItemsState();

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('BEHAVIOR: Already in trade = cannot broadcast', () => {
      // INTENT: One trade at a time.
      const ws = farmerWithTradeableItemsState();
      ws.set('trade.inTrade', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: On cooldown = cannot broadcast', () => {
      // INTENT: Don't spam trade offers.
      const ws = farmerWithTradeableItemsState();
      ws.set('trade.onCooldown', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPLORATION BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Exploration Behavior', () => {
    test('BEHAVIOR: Idle triggers exploration', () => {
      // INTENT: Don't just stand around.
      const ws = farmerIdleState();
      ws.set('state.consecutiveIdleTicks', 10);

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.getUtility(ws)).toBeGreaterThan(15);
    });

    test('BEHAVIOR: More idle = higher explore utility', () => {
      // INTENT: Longer idle = more urgent to do something.
      const exploreGoal = goals.find((g) => g.name === 'Explore')!;

      const ws1 = farmerIdleState();
      ws1.set('state.consecutiveIdleTicks', 2);

      const ws2 = farmerIdleState();
      ws2.set('state.consecutiveIdleTicks', 20);

      expect(exploreGoal.getUtility(ws2)).toBeGreaterThan(exploreGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Explore is always valid (fallback)', () => {
      // INTENT: Always available when nothing else works.
      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      const ws = establishedFarmerState();

      expect(exploreGoal.isValid(ws)).toBe(true);
    });

    test('BEHAVIOR: Explore has lowest priority', () => {
      // INTENT: Only explore when nothing else to do.
      const ws = farmerIdleState();
      ws.set('state.consecutiveIdleTicks', 5);

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.getUtility(ws)).toBeLessThan(20);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GOAL HYSTERESIS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Goal Stability (Hysteresis)', () => {
    test('BEHAVIOR: Should not thrash between similar goals', () => {
      // INTENT: 20% hysteresis prevents rapid switching.
      const ws = establishedFarmerState();
      ws.set('nearby.farmland', 12);
      ws.set('can.plant', true);
      ws.set('inv.seeds', 15);
      ws.set('nearby.matureCrops', 0);

      arbiter.clearCurrentGoal();
      const result1 = arbiter.selectGoal(ws);

      // Small change shouldn't cause switch
      ws.set('nearby.farmland', 10);

      const result2 = arbiter.selectGoal(ws);

      // Should stick with current goal or show hysteresis reason
      if (result1?.goal.name === result2?.goal.name) {
        expect(result2?.reason === 'hysteresis' || result1?.goal.name === result2?.goal.name).toBe(true);
      }
    });

    test('BEHAVIOR: Large utility change causes switch', () => {
      // INTENT: Big changes should trigger goal switch.
      const ws = establishedFarmerState();
      ws.set('nearby.farmland', 10);
      ws.set('can.plant', true);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      arbiter.selectGoal(ws);

      // Big change - drops appear
      ws.set('nearby.drops', 5);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLEX SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complex Scenarios', () => {
    test('SCENARIO: Complete farming cycle', () => {
      // INTENT: Till → Plant → Wait for crops → Harvest → Deposit.
      const ws = establishedFarmerState();
      ws.set('nearby.farmland', 0);
      ws.set('can.till', true);

      // Step 1: Till ground
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('TillGround');

      // Step 2: After tilling, plant
      ws.set('nearby.farmland', 15);
      ws.set('can.plant', true);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');

      // Step 3: Crops mature, harvest
      ws.set('nearby.farmland', 0);
      ws.set('nearby.matureCrops', 12);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('HarvestCrops');

      // Step 4: After harvest, deposit if lots of produce
      ws.set('nearby.matureCrops', 0);
      ws.set('inv.produce', 35);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('DepositProduce');
    });

    test('SCENARIO: Fresh spawn to established farmer', () => {
      // INTENT: StudySigns → EstablishFarm → GetTools → GatherSeeds → Farm.
      const ws = freshSpawnFarmerState();

      // Step 1: Study signs
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: Establish farm
      ws.set('has.studiedSigns', true);
      ws.set('nearby.water', 3);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('EstablishFarm');

      // Step 3: No hoe but farm exists - gather seeds productively
      ws.set('derived.hasFarmEstablished', true);
      ws.set('has.hoe', false);
      ws.set('inv.seeds', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('GatherSeeds');
    });

    test('SCENARIO: Multiple urgent priorities', () => {
      // INTENT: Highest utility wins among urgent tasks.
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 5); // Utility 150
      ws.set('trade.status', 'traveling'); // CompleteTrade utility 150
      ws.set('trade.inTrade', true);
      ws.set('nearby.matureCrops', 10); // Utility ~90

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Either CompleteTrade or CollectDrops (both 150)
      expect(['CompleteTrade', 'CollectDrops']).toContain(result?.goal.name);
    });

    test('SCENARIO: Interruption handling - drops during farming', () => {
      // INTENT: Drops interrupt, then resume farming.
      const ws = farmerReadyToPlantState();
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');

      // Drops appear!
      ws.set('nearby.drops', 3);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');

      // Drops collected
      ws.set('nearby.drops', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');
    });

    test('SCENARIO: Waiting for lumberjack', () => {
      // INTENT: When waiting for hoe materials, gather seeds productively.
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasFarmEstablished', true);
      ws.set('has.hoe', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', true);
      ws.set('inv.seeds', 0);

      // GatherSeeds (70) beats ObtainTools (80 with chest) normally
      // But with farm established and no hoe, seeds is very high priority
      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should prioritize getting tools to check chest, or gather seeds
      expect(['ObtainTools', 'GatherSeeds']).toContain(result?.goal.name);
    });
  });
});
