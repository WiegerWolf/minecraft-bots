import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import {
  farmerWithFullInventoryState,
  farmerWithDropsState,
  farmerWithMatureCropsState,
  farmerReadyToPlantState,
  establishedFarmerState,
} from '../../mocks';

/**
 * SPECIFICATION: Farmer Inventory Management
 *
 * Farmers must manage inventory for continuous operation:
 * - Collect drops before they despawn (urgent)
 * - Deposit produce at thresholds
 * - Requires storage access to deposit
 */

describe('Farmer Inventory', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Drop Collection', () => {
    test('SPEC: Drops preempt harvesting', () => {
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.drops', 4);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
    });

    test('SPEC: Drop utility scales with count (capped at 150)', () => {
      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;

      const ws1 = establishedFarmerState();
      ws1.set('nearby.drops', 1);

      const ws2 = establishedFarmerState();
      ws2.set('nearby.drops', 5);

      expect(collectGoal.getUtility(ws2)).toBeGreaterThan(collectGoal.getUtility(ws1));
      expect(collectGoal.getUtility(ws2)).toBe(150);
    });

    test('SPEC: No drops = zero utility', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 0);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Drops interrupt planting, then resume', () => {
      const ws = farmerReadyToPlantState();
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');

      // Drops appear
      ws.set('nearby.drops', 3);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');

      // Drops collected
      ws.set('nearby.drops', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');
    });
  });

  describe('Produce Deposit', () => {
    test('SPEC: Full inventory forces deposit (utility 90)', () => {
      const ws = farmerWithFullInventoryState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositProduce');
      expect(result?.utility).toBe(90);
    });

    test('SPEC: 32+ produce = high priority (70)', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 40);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: 16+ produce = medium priority (40)', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 20);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(40);
    });

    test('SPEC: 5+ produce = low priority (20)', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 8);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(20);
    });

    test('SPEC: No produce = zero utility', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 0);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No storage = cannot deposit', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 64);
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });
});
