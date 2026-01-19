import { describe, test, expect } from 'bun:test';
import { GOAPPlanner } from '../../src/planning/GOAPPlanner';
import { BaseGoal, numericGoalCondition, booleanGoalCondition } from '../../src/planning/Goal';
import { WorldState } from '../../src/planning/WorldState';
import {
  createMockAction,
  mockPickupItemsAction,
  mockHarvestCropsAction,
  mockPlantSeedsAction,
  mockCraftHoeAction,
  mockGatherSeedsAction,
  mockFindFarmCenterAction,
  mockExploreAction,
  mockProcessWoodAction,
} from '../mocks';
import { numericPrecondition, booleanPrecondition, incrementEffect, setEffect } from '../../src/planning/Action';

// ============================================================================
// Test Goals
// ============================================================================

class CollectDropsGoal extends BaseGoal {
  name = 'CollectDrops';
  description = 'Collect dropped items';
  conditions = [numericGoalCondition('nearby.drops', (v) => v === 0, 'no drops')];
  getUtility(): number {
    return 100;
  }
}

class HarvestGoal extends BaseGoal {
  name = 'Harvest';
  description = 'Harvest all crops';
  conditions = [numericGoalCondition('nearby.matureCrops', (v) => v === 0, 'no crops')];
  getUtility(): number {
    return 80;
  }
}

class ObtainHoeGoal extends BaseGoal {
  name = 'ObtainHoe';
  description = 'Get a hoe';
  conditions = [booleanGoalCondition('has.hoe', true, 'has hoe')];
  getUtility(): number {
    return 90;
  }
}

class GatherSeedsGoal extends BaseGoal {
  name = 'GatherSeeds';
  description = 'Get seeds';
  conditions = [
    numericGoalCondition('inv.seeds', (v) => v >= 10, 'enough seeds', {
      value: 10,
      comparison: 'gte',
      estimatedDelta: 5,
    }),
  ];
  getUtility(): number {
    return 50;
  }
}

class ExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Explore';
  conditions = [numericGoalCondition('state.consecutiveIdleTicks', (v) => v === 0, 'not idle')];
  getUtility(): number {
    return 10;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('GOAPPlanner', () => {
  describe('basic planning', () => {
    test('returns empty plan when goal already satisfied', () => {
      const actions = [mockPickupItemsAction()];
      const planner = new GOAPPlanner(actions);

      const ws = new WorldState();
      ws.set('nearby.drops', 0); // Already no drops

      const result = planner.plan(ws, new CollectDropsGoal());

      expect(result.success).toBe(true);
      expect(result.plan).toHaveLength(0);
      expect(result.cost).toBe(0);
    });

    test('finds single-action plan', () => {
      const actions = [mockPickupItemsAction()];
      const planner = new GOAPPlanner(actions);

      const ws = new WorldState();
      ws.set('nearby.drops', 5);
      ws.set('state.inventoryFull', false);

      const result = planner.plan(ws, new CollectDropsGoal());

      expect(result.success).toBe(true);
      expect(result.plan).toHaveLength(1);
      expect(result.plan[0]?.name).toBe('PickupItems');
    });

    test('finds multi-action plan', () => {
      // Goal: have hoe
      // State: no hoe, but have planks and crafting table
      // Plan: CraftHoe

      const actions = [mockCraftHoeAction()];
      const planner = new GOAPPlanner(actions);

      const ws = new WorldState();
      ws.set('has.hoe', false);
      ws.set('inv.planks', 4);
      ws.set('nearby.craftingTables', 1);

      const result = planner.plan(ws, new ObtainHoeGoal());

      expect(result.success).toBe(true);
      expect(result.plan.map((a) => a.name)).toContain('CraftHoe');
    });

    test('chains actions to satisfy preconditions', () => {
      // Goal: have 10 seeds
      // State: 0 seeds
      // Actions: GatherSeeds (gives 5 seeds)
      // Plan: GatherSeeds x2

      const actions = [mockGatherSeedsAction()];
      const planner = new GOAPPlanner(actions);

      const ws = new WorldState();
      ws.set('inv.seeds', 0);

      const result = planner.plan(ws, new GatherSeedsGoal());

      expect(result.success).toBe(true);
      expect(result.plan.length).toBeGreaterThanOrEqual(2); // Need at least 2 GatherSeeds
      expect(result.plan.every((a) => a.name === 'GatherSeeds')).toBe(true);
    });
  });

  describe('action chaining', () => {
    test('chains wood processing to crafting', () => {
      // Goal: have hoe
      // State: have logs, no planks
      // Actions: ProcessWood (logs -> planks), CraftHoe (planks -> hoe)
      // Expected plan: ProcessWood, CraftHoe

      const processWood = createMockAction({
        name: 'ProcessWood',
        preconditions: [numericPrecondition('inv.logs', (v) => v >= 1, 'has logs')],
        effects: [
          incrementEffect('inv.logs', -1, 'used log'),
          incrementEffect('inv.planks', 4, 'made planks'),
        ],
        cost: 1.0,
      });

      const craftHoe = createMockAction({
        name: 'CraftHoe',
        preconditions: [
          numericPrecondition('inv.planks', (v) => v >= 4, 'has planks'),
          numericPrecondition('nearby.craftingTables', (v) => v > 0, 'has table'),
        ],
        effects: [
          setEffect('has.hoe', true, 'has hoe'),
          incrementEffect('inv.planks', -4, 'used planks'),
        ],
        cost: 3.0,
      });

      const planner = new GOAPPlanner([processWood, craftHoe]);

      const ws = new WorldState();
      ws.set('has.hoe', false);
      ws.set('inv.logs', 2);
      ws.set('inv.planks', 0);
      ws.set('nearby.craftingTables', 1);

      const result = planner.plan(ws, new ObtainHoeGoal());

      expect(result.success).toBe(true);
      expect(result.plan.map((a) => a.name)).toEqual(['ProcessWood', 'CraftHoe']);
    });
  });

  describe('cost optimization', () => {
    test('prefers lower cost actions', () => {
      // Two ways to get seeds: cheap and expensive
      const cheapGather = createMockAction({
        name: 'CheapGather',
        preconditions: [],
        effects: [incrementEffect('inv.seeds', 10, 'got seeds')],
        cost: 1.0,
      });

      const expensiveGather = createMockAction({
        name: 'ExpensiveGather',
        preconditions: [],
        effects: [incrementEffect('inv.seeds', 10, 'got seeds')],
        cost: 10.0,
      });

      // Test with expensive first to ensure A* finds cheaper
      const planner = new GOAPPlanner([expensiveGather, cheapGather]);

      const ws = new WorldState();
      ws.set('inv.seeds', 0);

      const result = planner.plan(ws, new GatherSeedsGoal());

      expect(result.success).toBe(true);
      expect(result.plan[0]?.name).toBe('CheapGather');
    });
  });

  describe('plan failure', () => {
    test('fails when no actions can satisfy goal', () => {
      const actions = [mockPickupItemsAction()]; // Only handles drops
      const planner = new GOAPPlanner(actions);

      const ws = new WorldState();
      ws.set('has.hoe', false);
      ws.set('inv.planks', 0);

      // Try to get hoe - impossible with only PickupItems
      const result = planner.plan(ws, new ObtainHoeGoal());

      expect(result.success).toBe(false);
      expect(result.plan).toHaveLength(0);
    });

    test('fails when preconditions cannot be satisfied', () => {
      // CraftHoe needs planks + crafting table
      // No way to get planks or table
      const actions = [mockCraftHoeAction()];
      const planner = new GOAPPlanner(actions);

      const ws = new WorldState();
      ws.set('has.hoe', false);
      ws.set('inv.planks', 0);
      ws.set('nearby.craftingTables', 0);

      const result = planner.plan(ws, new ObtainHoeGoal());

      expect(result.success).toBe(false);
    });

    test('respects max iterations limit', () => {
      // Create a situation that would require many iterations
      const gatherAction = createMockAction({
        name: 'Gather',
        preconditions: [],
        effects: [incrementEffect('inv.items', 1, 'got item')],
        cost: 1.0,
      });

      // Goal: need 1000 items (would take 1000 actions)
      class BigGoal extends BaseGoal {
        name = 'BigGoal';
        description = 'Get many items';
        conditions = [
          numericGoalCondition('inv.items', (v) => v >= 1000, 'enough items', {
            value: 1000,
            comparison: 'gte',
            estimatedDelta: 1,
          }),
        ];
        getUtility(): number {
          return 50;
        }
      }

      const planner = new GOAPPlanner([gatherAction], { maxIterations: 100 });

      const ws = new WorldState();
      ws.set('inv.items', 0);

      const result = planner.plan(ws, new BigGoal());

      // Should fail due to max iterations, not find plan
      expect(result.success).toBe(false);
      expect(result.nodesExplored).toBeLessThanOrEqual(100);
    });
  });

  describe('state deduplication', () => {
    test('avoids exploring same state twice', () => {
      // Two actions that both lead to same state
      // Use a fact that's in importantFacts (inv.seeds)
      const action1 = createMockAction({
        name: 'Action1',
        preconditions: [],
        effects: [setEffect('inv.seeds', 10, 'set to 10')],
        cost: 1.0,
      });

      const action2 = createMockAction({
        name: 'Action2',
        preconditions: [],
        effects: [setEffect('inv.seeds', 10, 'also set to 10')],
        cost: 2.0,
      });

      class SeedsGoal extends BaseGoal {
        name = 'SeedsGoal';
        description = 'Get seeds to 10';
        conditions = [numericGoalCondition('inv.seeds', (v) => v === 10, 'seeds is 10')];
        getUtility(): number {
          return 50;
        }
      }

      const planner = new GOAPPlanner([action1, action2]);
      const ws = new WorldState();
      ws.set('inv.seeds', 0);

      const result = planner.plan(ws, new SeedsGoal());

      expect(result.success).toBe(true);
      // Should use cheaper action
      expect(result.plan[0]?.name).toBe('Action1');
      // Should not explore excessively due to deduplication
      expect(result.nodesExplored).toBeLessThan(10);
    });
  });

  describe('heuristic guidance', () => {
    test('uses numericTarget for better estimates', () => {
      // With good heuristic metadata, planner should find plan faster
      const gatherAction = createMockAction({
        name: 'Gather',
        preconditions: [],
        effects: [incrementEffect('inv.seeds', 5, 'got seeds')],
        cost: 1.0,
      });

      // Goal with numeric target metadata
      class SeedsGoalWithMeta extends BaseGoal {
        name = 'SeedsGoal';
        description = 'Get seeds';
        conditions = [
          numericGoalCondition('inv.seeds', (v) => v >= 20, 'enough seeds', {
            value: 20,
            comparison: 'gte',
            estimatedDelta: 5, // Match action effect
          }),
        ];
        getUtility(): number {
          return 50;
        }
      }

      const planner = new GOAPPlanner([gatherAction]);
      const ws = new WorldState();
      ws.set('inv.seeds', 0);

      const result = planner.plan(ws, new SeedsGoalWithMeta());

      expect(result.success).toBe(true);
      expect(result.plan.length).toBe(4); // Exactly 4 * 5 = 20 seeds
    });
  });

  describe('action management', () => {
    test('addAction adds new action', () => {
      const planner = new GOAPPlanner([]);
      expect(planner.getActions()).toHaveLength(0);

      planner.addAction(mockPickupItemsAction());
      expect(planner.getActions()).toHaveLength(1);
    });

    test('removeAction removes action by name', () => {
      const planner = new GOAPPlanner([
        mockPickupItemsAction(),
        mockHarvestCropsAction(),
      ]);
      expect(planner.getActions()).toHaveLength(2);

      planner.removeAction('PickupItems');
      expect(planner.getActions()).toHaveLength(1);
      expect(planner.getActions()[0]?.name).toBe('HarvestCrops');
    });
  });
});
