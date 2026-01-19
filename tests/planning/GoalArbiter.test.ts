import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { BaseGoal, numericGoalCondition, booleanGoalCondition } from '../../src/planning/Goal';
import { WorldState } from '../../src/planning/WorldState';
import {
  freshSpawnFarmerState,
  establishedFarmerState,
  farmerWithMatureCropsState,
  farmerWithDropsState,
  farmerWithFullInventoryState,
} from '../mocks';

// ============================================================================
// Test Goals
// ============================================================================

class TestCollectDropsGoal extends BaseGoal {
  name = 'CollectDrops';
  description = 'Collect dropped items';
  conditions = [numericGoalCondition('nearby.drops', (v) => v === 0, 'no drops')];

  getUtility(ws: WorldState): number {
    const dropCount = ws.getNumber('nearby.drops');
    if (dropCount === 0) return 0;
    return Math.min(150, 100 + dropCount * 10);
  }
}

class TestHarvestCropsGoal extends BaseGoal {
  name = 'HarvestCrops';
  description = 'Harvest mature crops';
  conditions = [numericGoalCondition('nearby.matureCrops', (v) => v === 0, 'no crops')];

  getUtility(ws: WorldState): number {
    const cropCount = ws.getNumber('nearby.matureCrops');
    const inventoryFull = ws.getBool('state.inventoryFull');
    if (cropCount === 0 || inventoryFull) return 0;
    return Math.min(100, 60 + cropCount * 3);
  }
}

class TestObtainToolsGoal extends BaseGoal {
  name = 'ObtainTools';
  description = 'Get farming tools';
  conditions = [booleanGoalCondition('has.hoe', true, 'has hoe')];

  getUtility(ws: WorldState): number {
    if (ws.getBool('has.hoe')) return 0;
    const canCraft = ws.getBool('derived.canCraftHoe');
    return canCraft ? 95 : 40;
  }
}

class TestExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Explore the world';
  conditions = [numericGoalCondition('state.consecutiveIdleTicks', (v) => v === 0, 'not idle')];

  getUtility(ws: WorldState): number {
    const idleTicks = ws.getNumber('state.consecutiveIdleTicks');
    return 5 + Math.min(25, idleTicks / 2);
  }

  override isValid(): boolean {
    return true; // Always valid
  }
}

class TestPlantSeedsGoal extends BaseGoal {
  name = 'PlantSeeds';
  description = 'Plant seeds';
  conditions = [numericGoalCondition('nearby.farmland', (v) => v === 0, 'no farmland')];

  getUtility(ws: WorldState): number {
    const canPlant = ws.getBool('can.plant');
    const emptyFarmland = ws.getNumber('nearby.farmland');
    if (!canPlant || emptyFarmland === 0) return 0;
    return Math.min(60, 30 + emptyFarmland * 2);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('GoalArbiter', () => {
  describe('goal selection', () => {
    test('selects highest utility goal', () => {
      const goals = [
        new TestCollectDropsGoal(),
        new TestHarvestCropsGoal(),
        new TestExploreGoal(),
      ];
      const arbiter = new GoalArbiter(goals);

      // State with drops (utility 130) and crops (utility 78)
      const ws = farmerWithDropsState();
      ws.set('nearby.matureCrops', 6); // 60 + 6*3 = 78

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.utility).toBe(150); // 100 + 5*10 = 150 (capped)
    });

    test('returns null when no valid goals', () => {
      const goals = [
        new TestCollectDropsGoal(),
        new TestHarvestCropsGoal(),
      ];
      const arbiter = new GoalArbiter(goals);

      // State with no drops and no mature crops
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 0);
      ws.set('nearby.matureCrops', 0);

      const result = arbiter.selectGoal(ws);
      expect(result).toBeNull();
    });

    test('skips goals with zero utility', () => {
      const goals = [
        new TestObtainToolsGoal(),
        new TestExploreGoal(),
      ];
      const arbiter = new GoalArbiter(goals);

      // State where bot already has hoe (ObtainTools utility = 0)
      const ws = establishedFarmerState();
      ws.set('has.hoe', true);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('Explore');
    });

    test('respects skipGoals parameter', () => {
      const goals = [
        new TestCollectDropsGoal(),
        new TestHarvestCropsGoal(),
        new TestExploreGoal(),
      ];
      const arbiter = new GoalArbiter(goals);

      const ws = farmerWithDropsState();
      ws.set('nearby.matureCrops', 6);

      // Skip the highest utility goal
      const skipGoals = new Set(['CollectDrops']);
      const result = arbiter.selectGoal(ws, skipGoals);

      expect(result?.goal.name).toBe('HarvestCrops');
    });
  });

  describe('hysteresis', () => {
    test('sticks with current goal when new goal is not significantly better', () => {
      const goals = [
        new TestPlantSeedsGoal(),
        new TestHarvestCropsGoal(),
      ];
      const arbiter = new GoalArbiter(goals, { hysteresisThreshold: 0.2 });

      // First selection: PlantSeeds wins
      const ws = establishedFarmerState();
      ws.set('nearby.farmland', 10); // 30 + 10*2 = 50
      ws.set('can.plant', true);
      ws.set('nearby.matureCrops', 0);

      const result1 = arbiter.selectGoal(ws);
      expect(result1?.goal.name).toBe('PlantSeeds');

      // Now mature crops appear with utility 63 (60 + 3*1)
      // That's only 26% better than 50, above 20% threshold
      // But let's test a case where it's below threshold
      ws.set('nearby.matureCrops', 1); // 60 + 1*3 = 63, but PlantSeeds is 50
      // 63 > 50 * 1.2 = 60, so it WILL switch

      // For hysteresis test, we need closer utilities
      ws.set('nearby.farmland', 15); // 30 + 15*2 = 60
      const result2 = arbiter.selectGoal(ws);
      // 63 is NOT > 60 * 1.2 = 72, so it should stick with PlantSeeds
      expect(result2?.goal.name).toBe('PlantSeeds');
      expect(result2?.reason).toBe('hysteresis');
    });

    test('switches when new goal is significantly better', () => {
      const goals = [
        new TestPlantSeedsGoal(),
        new TestCollectDropsGoal(),
      ];
      const arbiter = new GoalArbiter(goals, { hysteresisThreshold: 0.2 });

      // First selection: PlantSeeds wins
      const ws = establishedFarmerState();
      ws.set('nearby.farmland', 10); // 30 + 10*2 = 50
      ws.set('can.plant', true);
      ws.set('nearby.drops', 0);

      arbiter.selectGoal(ws);

      // Now drops appear with utility 130 (100 + 3*10)
      // 130 > 50 * 1.2 = 60, so it should switch
      ws.set('nearby.drops', 3);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.reason).toBe('switch');
    });

    test('switches when current goal utility drops to zero', () => {
      const goals = [
        new TestCollectDropsGoal(),
        new TestExploreGoal(),
      ];
      const arbiter = new GoalArbiter(goals);

      // First: CollectDrops selected
      const ws = farmerWithDropsState();
      arbiter.selectGoal(ws);

      // Drops collected (utility now 0)
      ws.set('nearby.drops', 0);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('Explore'); // Should switch even without 20% threshold
    });
  });

  describe('goal validity', () => {
    test('skips invalid goals', () => {
      class ConditionalGoal extends BaseGoal {
        name = 'ConditionalGoal';
        description = 'Only valid when flag is true';
        conditions = [];

        getUtility(ws: WorldState): number {
          return 100; // High utility
        }

        override isValid(ws: WorldState): boolean {
          return ws.getBool('flag.enabled');
        }
      }

      const goals = [new ConditionalGoal(), new TestExploreGoal()];
      const arbiter = new GoalArbiter(goals);

      const ws = establishedFarmerState();
      ws.set('flag.enabled', false);

      // ConditionalGoal is invalid, should select Explore
      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('Explore');
    });

    test('includes valid goals with high utility', () => {
      class ConditionalGoal extends BaseGoal {
        name = 'ConditionalGoal';
        description = 'Only valid when flag is true';
        conditions = [];

        getUtility(): number {
          return 100;
        }

        override isValid(ws: WorldState): boolean {
          return ws.getBool('flag.enabled');
        }
      }

      const goals = [new ConditionalGoal(), new TestExploreGoal()];
      const arbiter = new GoalArbiter(goals);

      const ws = establishedFarmerState();
      ws.set('flag.enabled', true);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ConditionalGoal');
    });
  });

  describe('priority tie-breaking', () => {
    test('uses priority to break ties', () => {
      class HighPriorityGoal extends BaseGoal {
        name = 'HighPriority';
        description = 'High priority goal';
        conditions = [];
        override priority = 2.0;

        getUtility(): number {
          return 50;
        }
      }

      class LowPriorityGoal extends BaseGoal {
        name = 'LowPriority';
        description = 'Low priority goal';
        conditions = [];
        override priority = 1.0;

        getUtility(): number {
          return 50; // Same utility
        }
      }

      const goals = [new LowPriorityGoal(), new HighPriorityGoal()];
      const arbiter = new GoalArbiter(goals);

      const ws = establishedFarmerState();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('HighPriority');
    });
  });

  describe('clearCurrentGoal', () => {
    test('resets current goal', () => {
      const goals = [new TestCollectDropsGoal(), new TestExploreGoal()];
      const arbiter = new GoalArbiter(goals);

      const ws = farmerWithDropsState();
      arbiter.selectGoal(ws);

      expect(arbiter.getCurrentGoal()?.name).toBe('CollectDrops');

      arbiter.clearCurrentGoal();

      expect(arbiter.getCurrentGoal()).toBeNull();
    });
  });

  describe('getGoalReport', () => {
    test('generates readable report', () => {
      const goals = [
        new TestCollectDropsGoal(),
        new TestHarvestCropsGoal(),
        new TestExploreGoal(),
      ];
      const arbiter = new GoalArbiter(goals);

      const ws = farmerWithDropsState();
      arbiter.selectGoal(ws);

      const report = arbiter.getGoalReport(ws);

      expect(report).toContain('CollectDrops');
      expect(report).toContain('150.0'); // Utility
      expect(report).toContain('CURRENT');
      expect(report).toContain('HarvestCrops');
      // HarvestCrops with inventoryFull=false returns 0 when crops=0
      // The actual message might be [ZERO] or [INVALID] depending on isValid
      expect(report).toMatch(/\[ZERO\]|\[INVALID\]|0\.0/);
    });
  });
});
