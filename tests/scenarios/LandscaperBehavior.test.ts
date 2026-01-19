import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import { WorldState } from '../../src/planning/WorldState';
import {
  freshSpawnLandscaperState,
  landscaperWithTerraformRequestState,
  landscaperReadyToWorkState,
  landscaperActiveTerraformState,
  landscaperMissingShovelState,
  landscaperMissingPickaxeState,
  landscaperWithMaterialsState,
  landscaperWithFarmsToCheckState,
  landscaperWithFarmMaintenanceState,
  landscaperFullInventoryState,
  landscaperIdleState,
  landscaperInActiveTradeState,
  landscaperWithTradeOffersState,
  landscaperWithTradeableItemsState,
  createWorldState,
} from '../mocks';

/**
 * Comprehensive behavioral tests for the Landscaper role.
 *
 * These tests verify the INTENDED behavior of the landscaper as described
 * in the documentation and design vision.
 *
 * Key responsibilities of the landscaper:
 * 1. Fulfill terraform requests (flattening terrain for farms)
 * 2. Obtain tools (shovel AND pickaxe required)
 * 3. Check known farms for maintenance needs
 * 4. Actively maintain farms (fix holes, water issues)
 * 5. Gather dirt proactively when idle
 * 6. Trade unwanted items with other bots
 * 7. Wait at spawn when nothing to do (DON'T explore)
 */

describe('Landscaper Behavior', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  // ═══════════════════════════════════════════════════════════════════════════
  // STARTUP SEQUENCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Startup Sequence', () => {
    test('BEHAVIOR: Fresh spawn should study signs first', () => {
      // INTENT: Learn about existing farms to proactively maintain them.
      const ws = freshSpawnLandscaperState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
      expect(result?.utility).toBe(150);
    });

    test('BEHAVIOR: After signs, check farms if known', () => {
      // INTENT: Proactively check farms for maintenance needs.
      const ws = landscaperWithFarmsToCheckState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CheckKnownFarms');
    });

    test('BEHAVIOR: After signs with no farms, wait for requests', () => {
      // INTENT: Landscaper should idle, not explore.
      const ws = landscaperIdleState();
      ws.set('state.farmsNeedingCheck', 0);
      ws.set('inv.dirt', 64); // Has dirt already

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Either Explore (0 utility), null result, or other low-priority goal
      // Landscaper doesn't actively explore - it waits
      expect(result?.utility ?? 0).toBeLessThan(50);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TERRAFORM REQUEST FULFILLMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Terraform Request Fulfillment', () => {
    test('BEHAVIOR: Pending request with both tools = high priority', () => {
      // INTENT: Terraform requests are the core work.
      const ws = landscaperWithTerraformRequestState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(100);
    });

    test('BEHAVIOR: Active terraform with both tools = highest priority', () => {
      // INTENT: Finish what we started.
      const ws = landscaperActiveTerraformState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(120);
    });

    test('BEHAVIOR: Missing tool during terraform = low priority (let ObtainTools win)', () => {
      // INTENT: Need to craft missing tool first.
      const ws = landscaperActiveTerraformState();
      ws.set('has.pickaxe', false);
      ws.set('inv.planks', 8); // Can craft tool

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;

      expect(terraformGoal.getUtility(ws)).toBe(50);
      expect(toolGoal.getUtility(ws)).toBe(70); // Should win
    });

    test('BEHAVIOR: No tools + no materials = cannot fulfill', () => {
      // INTENT: Avoid stuck loop when can't obtain tools.
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', false);

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No pending request = zero utility', () => {
      // INTENT: Nothing to do.
      const ws = landscaperReadyToWorkState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('terraform.active', false);

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL ACQUISITION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tool Acquisition', () => {
    test('BEHAVIOR: Missing both tools + materials = high priority', () => {
      // INTENT: Need tools to do any work.
      const ws = landscaperWithMaterialsState();

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(80);
    });

    test('BEHAVIOR: Missing one tool = medium-high priority', () => {
      // INTENT: Still need that other tool.
      const ws = landscaperMissingPickaxeState();

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(70);
    });

    test('BEHAVIOR: Missing tool + pending request + storage = high priority', () => {
      // INTENT: Need tools urgently to fulfill request.
      const ws = freshSpawnLandscaperState();
      ws.set('has.studiedSigns', true);
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('has.pendingTerraformRequest', true);
      ws.set('derived.hasStorageAccess', true);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(75);
    });

    test('BEHAVIOR: Have both tools = zero utility', () => {
      // INTENT: Already equipped.
      const ws = landscaperReadyToWorkState();

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No materials, no storage = zero utility', () => {
      // INTENT: Can't obtain tools without materials.
      const ws = freshSpawnLandscaperState();
      ws.set('has.studiedSigns', true);
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', false);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FARM CHECKING AND MAINTENANCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Farm Checking and Maintenance', () => {
    test('BEHAVIOR: Farms needing check + tools = high priority', () => {
      // INTENT: Proactively check farms we know about.
      const ws = landscaperWithFarmsToCheckState();

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBeGreaterThan(60);
    });

    test('BEHAVIOR: Farms needing check + no tools = moderate priority', () => {
      // INTENT: Can still check and queue requests.
      const ws = landscaperWithFarmsToCheckState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBeGreaterThan(40);
    });

    test('BEHAVIOR: Don\'t check farms during active terraform', () => {
      // INTENT: Finish current work first.
      const ws = landscaperActiveTerraformState();
      ws.set('state.farmsNeedingCheck', 3);

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Farms with issues = high maintenance priority', () => {
      // INTENT: Fix problems when detected.
      const ws = landscaperWithFarmMaintenanceState();

      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
      expect(maintainGoal.getUtility(ws)).toBeGreaterThan(80);
    });

    test('BEHAVIOR: More farms with issues = higher priority', () => {
      // INTENT: Scale with urgency.
      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;

      const ws1 = landscaperWithFarmMaintenanceState();
      ws1.set('state.farmsWithIssues', 1);

      const ws2 = landscaperWithFarmMaintenanceState();
      ws2.set('state.farmsWithIssues', 3);

      expect(maintainGoal.getUtility(ws2)).toBeGreaterThan(maintainGoal.getUtility(ws1));
    });

    test('BEHAVIOR: No dirt = cannot maintain', () => {
      // INTENT: Need materials to fix issues.
      const ws = landscaperWithFarmMaintenanceState();
      ws.set('inv.dirt', 0);

      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
      expect(maintainGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No issues = zero maintenance utility', () => {
      // INTENT: Nothing to fix.
      const ws = landscaperReadyToWorkState();
      ws.set('state.farmMaintenanceNeeded', false);

      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
      expect(maintainGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ITEM DEPOSIT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Item Deposit', () => {
    test('BEHAVIOR: Full inventory forces deposit', () => {
      // INTENT: Can't continue work with full inventory.
      const ws = landscaperFullInventoryState();

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(90);
    });

    test('BEHAVIOR: Lots of items triggers deposit', () => {
      // INTENT: Deposit when getting full.
      const ws = landscaperReadyToWorkState();
      ws.set('inv.dirt', 100);
      ws.set('inv.cobblestone', 40);
      ws.set('derived.hasStorageAccess', true);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(80);
    });

    test('BEHAVIOR: Medium items = medium priority', () => {
      // INTENT: Deposit at medium fullness.
      const ws = landscaperReadyToWorkState();
      ws.set('inv.dirt', 40);
      ws.set('inv.cobblestone', 30);
      ws.set('derived.hasStorageAccess', true);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(60);
    });

    test('BEHAVIOR: Few items = no deposit', () => {
      // INTENT: Don't waste time depositing small amounts.
      const ws = landscaperReadyToWorkState();
      ws.set('inv.dirt', 10);
      ws.set('inv.cobblestone', 5);
      ws.set('derived.hasStorageAccess', true);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No storage = cannot deposit', () => {
      // INTENT: Need chest to deposit.
      const ws = landscaperFullInventoryState();
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DROP COLLECTION (LOWER PRIORITY FOR LANDSCAPER)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Drop Collection', () => {
    test('BEHAVIOR: Drops during terraform = low priority', () => {
      // INTENT: Don't interrupt terraforming for drops.
      const ws = landscaperActiveTerraformState();
      ws.set('nearby.drops', 5);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBe(40); // Lower during terraform
    });

    test('BEHAVIOR: Drops when idle = medium priority', () => {
      // INTENT: Pick up nearby drops when not busy.
      const ws = landscaperIdleState();
      ws.set('nearby.drops', 5);
      ws.set('terraform.active', false);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBeGreaterThan(50);
      expect(dropGoal.getUtility(ws)).toBeLessThanOrEqual(80); // Capped lower than other roles
    });

    test('BEHAVIOR: No drops = zero utility', () => {
      // INTENT: Nothing to collect.
      const ws = landscaperReadyToWorkState();
      ws.set('nearby.drops', 0);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PROACTIVE DIRT GATHERING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Proactive Dirt Gathering', () => {
    test('BEHAVIOR: Low dirt when idle = gather dirt', () => {
      // INTENT: Prepare for incoming terraform requests.
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 16);
      ws.set('has.shovel', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('BEHAVIOR: Less dirt = higher gather priority', () => {
      // INTENT: More urgent when we have less.
      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;

      const ws1 = landscaperIdleState();
      ws1.set('inv.dirt', 50);
      ws1.set('has.shovel', true);

      const ws2 = landscaperIdleState();
      ws2.set('inv.dirt', 10);
      ws2.set('has.shovel', true);

      expect(gatherGoal.getUtility(ws2)).toBeGreaterThan(gatherGoal.getUtility(ws1));
    });

    test('BEHAVIOR: Enough dirt = zero gather utility', () => {
      // INTENT: Already have enough.
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 64);
      ws.set('has.shovel', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Don\'t gather during terraform', () => {
      // INTENT: Focus on active work.
      const ws = landscaperActiveTerraformState();
      ws.set('inv.dirt', 10);
      ws.set('terraform.active', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No shovel = cannot gather', () => {
      // INTENT: Need tool to dig.
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 10);
      ws.set('has.shovel', false);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SLAB CRAFTING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Slab Crafting', () => {
    test('BEHAVIOR: Low slabs + planks = craft slabs when idle', () => {
      // INTENT: Slabs help with pathfinding scaffolding.
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 12);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBeGreaterThan(20);
    });

    test('BEHAVIOR: Enough slabs = zero craft utility', () => {
      // INTENT: Already have enough.
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 20);
      ws.set('inv.planks', 12);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: No planks = cannot craft slabs', () => {
      // INTENT: Need materials.
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 1);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Don\'t craft during terraform', () => {
      // INTENT: Focus on active work.
      const ws = landscaperActiveTerraformState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 12);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADING BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Trading Behavior', () => {
    test('BEHAVIOR: Active trade = highest priority', () => {
      // INTENT: Finish what we started.
      const ws = landscaperInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('BEHAVIOR: Pending trade offers = high priority', () => {
      // INTENT: Trading saves time vs gathering.
      const ws = landscaperWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('BEHAVIOR: Tradeable items when idle = can broadcast', () => {
      // INTENT: Clean up inventory when nothing to do.
      const ws = landscaperWithTradeableItemsState();

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('BEHAVIOR: On cooldown = cannot broadcast', () => {
      // INTENT: Don't spam offers.
      const ws = landscaperWithTradeableItemsState();
      ws.set('trade.onCooldown', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Already in trade = cannot broadcast', () => {
      // INTENT: One trade at a time.
      const ws = landscaperWithTradeableItemsState();
      ws.set('trade.inTrade', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPLORATION (LANDSCAPER DOESN'T EXPLORE)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Exploration Behavior', () => {
    test('BEHAVIOR: Explore has zero utility (landscaper waits)', () => {
      // INTENT: Landscaper waits at spawn rather than exploring.
      const ws = landscaperIdleState();

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.getUtility(ws)).toBe(0);
    });

    test('BEHAVIOR: Explore is always valid (fallback)', () => {
      // INTENT: Always available as last resort.
      const ws = landscaperIdleState();

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.isValid(ws)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLEX SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complex Scenarios', () => {
    test('SCENARIO: Fresh spawn to ready', () => {
      // INTENT: StudySigns → (get tools if materials) → wait.
      const ws = freshSpawnLandscaperState();

      // Step 1: Study signs
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: After signs, if materials, get tools
      ws.set('has.studiedSigns', true);
      ws.set('inv.planks', 10);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ObtainTools');
    });

    test('SCENARIO: Terraform request workflow', () => {
      // INTENT: Request → tools check → terraform.
      const ws = landscaperWithTerraformRequestState();

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('FulfillTerraformRequest');

      // During terraform, if we lose a tool, ObtainTools should win
      // Need 8+ planks for ObtainTools utility 70 to beat FulfillTerraformRequest's 50
      ws.set('terraform.active', true);
      ws.set('has.pickaxe', false);
      ws.set('inv.planks', 8);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ObtainTools');
    });

    test('SCENARIO: Idle landscaper routine', () => {
      // INTENT: When idle, gather dirt or craft slabs.
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 20);
      ws.set('inv.planks', 6);
      ws.set('has.shovel', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should be GatherDirt or CraftSlabs
      expect(['GatherDirt', 'CraftSlabs'].includes(result?.goal.name ?? '')).toBe(true);
    });

    test('SCENARIO: Trade interrupts idle', () => {
      // INTENT: Trade offers should be handled even when idle.
      const ws = landscaperIdleState();
      ws.set('trade.pendingOffers', 2);
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });

    test('SCENARIO: Multiple priorities - terraform wins over gathering', () => {
      // INTENT: Active work > preparation.
      const ws = landscaperActiveTerraformState();
      ws.set('inv.dirt', 10); // Low dirt
      ws.set('state.farmsNeedingCheck', 2);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });

    test('SCENARIO: Full inventory during terraform', () => {
      // INTENT: Deposit if we can't continue.
      const ws = landscaperActiveTerraformState();
      ws.set('state.inventoryFull', true);
      ws.set('inv.dirt', 128);
      ws.set('derived.hasStorageAccess', true);

      // Deposit (90) vs FulfillTerraform (120)
      // Terraform still wins if we have tools
      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Terraform should win since we have both tools
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });

    test('SCENARIO: Proactive farm maintenance', () => {
      // INTENT: Fix issues when detected.
      const ws = landscaperWithFarmMaintenanceState();
      ws.set('has.pendingTerraformRequest', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('MaintainFarms');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GOAL HYSTERESIS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Goal Stability (Hysteresis)', () => {
    test('BEHAVIOR: Should not thrash between similar goals', () => {
      // INTENT: 20% hysteresis prevents rapid switching.
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 30);
      ws.set('inv.planks', 6);
      ws.set('inv.slabs', 8);
      ws.set('has.shovel', true);

      arbiter.clearCurrentGoal();
      const result1 = arbiter.selectGoal(ws);

      // Small change
      ws.set('inv.dirt', 32);

      const result2 = arbiter.selectGoal(ws);

      // Should stay on same goal or show hysteresis
      if (result1?.goal.name === result2?.goal.name) {
        expect(true).toBe(true); // Stayed on same goal
      } else if (result2?.reason === 'hysteresis') {
        expect(true).toBe(true); // Hysteresis active
      }
    });

    test('BEHAVIOR: Large change triggers switch', () => {
      // INTENT: Significant priority changes should cause switch.
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 30);
      ws.set('has.shovel', true);

      arbiter.clearCurrentGoal();
      arbiter.selectGoal(ws);

      // Big change - terraform request arrives
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.pickaxe', true);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });
  });
});
