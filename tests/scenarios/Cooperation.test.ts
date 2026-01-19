import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackWithFarmerRequestState,
  lumberjackReadyToChopState,
  lumberjackNeedsInfrastructureState,
  landscaperWithTerraformRequestState,
  landscaperActiveTerraformState,
} from '../mocks';

/**
 * SPECIFICATION: Cooperation
 *
 * Bots cooperate through:
 * - Request fulfillment (lumberjack → farmer)
 * - Terraform requests (farmer → landscaper)
 * - Infrastructure creation (shared crafting tables, chests)
 *
 * Key principle: Helping other bots has higher priority than solo work
 * because village success depends on cooperation.
 */

describe('Cooperation', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // LUMBERJACK FULFILLS FARMER REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lumberjack Fulfills Farmer Requests', () => {
    const goals = createLumberjackGoals();
    const arbiter = new GoalArbiter(goals);

    test('SPEC: Pending farmer request = high priority', () => {
      const ws = lumberjackWithFarmerRequestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillRequests');
      expect(result?.utility).toBeGreaterThanOrEqual(85);
    });

    test('SPEC: Request + materials = higher priority (120)', () => {
      const ws = lumberjackWithFarmerRequestState();
      ws.set('inv.logs', 8);
      ws.set('inv.planks', 4);

      const fulfillGoal = goals.find((g) => g.name === 'FulfillRequests')!;
      expect(fulfillGoal.getUtility(ws)).toBe(120);
    });

    test('SPEC: Request without materials = lower priority', () => {
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
    });

    test('SPEC: No pending request = zero utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('has.pendingRequests', false);

      const fulfillGoal = goals.find((g) => g.name === 'FulfillRequests')!;
      expect(fulfillGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Request preempts normal chopping', () => {
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
  // LANDSCAPER FULFILLS TERRAFORM REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Landscaper Fulfills Terraform Requests', () => {
    const goals = createLandscaperGoals();
    const arbiter = new GoalArbiter(goals);

    test('SPEC: Pending terraform request + tools = high priority (100)', () => {
      const ws = landscaperWithTerraformRequestState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(100);
    });

    test('SPEC: Active terraform = highest priority (120)', () => {
      const ws = landscaperActiveTerraformState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(120);
    });

    test('SPEC: Request triggers immediate work', () => {
      const ws = landscaperWithTerraformRequestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INFRASTRUCTURE CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Infrastructure Creation', () => {
    const goals = createLumberjackGoals();

    test('SPEC: Crafting table + materials = should craft (65)', () => {
      const ws = lumberjackNeedsInfrastructureState();

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(65);
    });

    test('SPEC: Chest + materials = lower priority (45)', () => {
      const ws = lumberjackNeedsInfrastructureState();
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', true);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(45);
    });

    test('SPEC: Crafting table > chest priority', () => {
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

    test('SPEC: No infrastructure needs = zero utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', false);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(0);
    });
  });
});
