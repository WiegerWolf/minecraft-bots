import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import {
  lumberjackWithFarmerRequestState,
  lumberjackReadyToChopState,
  lumberjackNeedsInfrastructureState,
} from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Cooperation
 *
 * Lumberjacks cooperate through:
 * - Fulfilling farmer requests for wood
 * - Creating shared infrastructure (crafting tables, chests)
 */

describe('Lumberjack Cooperation', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Farmer Request Fulfillment', () => {
    test('SPEC: Pending farmer request = high priority', () => {
      const ws = lumberjackWithFarmerRequestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillNeeds');
      expect(result?.utility).toBeGreaterThanOrEqual(85);
    });

    test('SPEC: Request + materials = higher priority (120)', () => {
      const ws = lumberjackWithFarmerRequestState();
      ws.set('inv.logs', 8);
      ws.set('inv.planks', 4);
      ws.set('can.spareForNeeds', true);  // Has enough to spare

      const fulfillGoal = goals.find((g) => g.name === 'FulfillNeeds')!;
      expect(fulfillGoal.getUtility(ws)).toBe(120);
    });

    test('SPEC: Request without materials = lower priority', () => {
      const wsWithMaterials = lumberjackWithFarmerRequestState();
      wsWithMaterials.set('inv.logs', 8);
      wsWithMaterials.set('inv.planks', 4);
      wsWithMaterials.set('can.spareForNeeds', true);  // Has enough to spare

      const wsWithoutMaterials = lumberjackWithFarmerRequestState();
      wsWithoutMaterials.set('inv.logs', 0);
      wsWithoutMaterials.set('inv.planks', 0);
      wsWithoutMaterials.set('can.spareForNeeds', false);  // Nothing to spare

      const fulfillGoal = goals.find((g) => g.name === 'FulfillNeeds')!;
      const utilityWith = fulfillGoal.getUtility(wsWithMaterials);
      const utilityWithout = fulfillGoal.getUtility(wsWithoutMaterials);

      expect(utilityWith).toBeGreaterThan(utilityWithout);
    });

    test('SPEC: No pending request = zero utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('has.incomingNeeds', false);

      const fulfillGoal = goals.find((g) => g.name === 'FulfillNeeds')!;
      expect(fulfillGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Request preempts normal chopping', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('has.incomingNeeds', true);
      ws.set('inv.logs', 8);
      ws.set('can.spareForNeeds', true);  // Has enough to spare
      ws.set('derived.hasStorageAccess', true);
      ws.set('nearby.reachableTrees', 10);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillNeeds');
    });
  });

  describe('Infrastructure Creation', () => {
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

    test('SPEC: No materials = zero utility', () => {
      const ws = lumberjackNeedsInfrastructureState();
      ws.set('inv.planks', 0);
      ws.set('inv.logs', 0);

      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Bootstrap sequence - table then chest', () => {
      const ws = lumberjackNeedsInfrastructureState();

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CraftInfrastructure');

      // After table placed, still need chest
      ws.set('derived.needsCraftingTable', false);
      ws.set('derived.needsChest', true);
      result = arbiter.selectGoal(ws);
      // Either continues CraftInfrastructure or moves on - depends on utility
      const infraGoal = goals.find((g) => g.name === 'CraftInfrastructure')!;
      expect(infraGoal.getUtility(ws)).toBeGreaterThan(0);
    });
  });
});
