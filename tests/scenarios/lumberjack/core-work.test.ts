import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import {
  lumberjackReadyToChopState,
  lumberjackMidTreeHarvestState,
  lumberjackWithSaplingsState,
} from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Core Work
 *
 * The lumberjack's primary responsibilities:
 * - Chop trees to gather logs
 * - Complete mid-harvest trees
 * - Plant saplings for sustainability
 * - Process wood into planks
 */

describe('Lumberjack Core Work', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Tree Chopping', () => {
    test('SPEC: With axe and trees, should chop', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('ChopTree');
    });

    test('SPEC: More forest trees = higher utility', () => {
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      const ws1 = lumberjackReadyToChopState();
      ws1.set('nearby.forestTrees', 2);
      ws1.set('inv.logs', 0);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('nearby.forestTrees', 10);
      ws2.set('inv.logs', 0);

      expect(chopGoal.getUtility(ws2)).toBeGreaterThan(chopGoal.getUtility(ws1));
    });

    test('SPEC: 16+ logs = goal satisfied (utility 0)', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 16);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No forest trees = cannot chop', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.forestTrees', 0);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Full inventory = cannot chop', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('state.inventoryFull', true);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Tree Harvest Completion', () => {
    test('SPEC: Mid-harvest should complete first (utility 85)', () => {
      const ws = lumberjackMidTreeHarvestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTreeHarvest');
      expect(result?.utility).toBe(85);
    });
  });

  describe('Sapling Planting', () => {
    test('SPEC: With saplings, should plant for sustainability', () => {
      const ws = lumberjackWithSaplingsState();
      ws.set('tree.active', false);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: More saplings = higher priority', () => {
      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;

      const ws1 = lumberjackWithSaplingsState();
      ws1.set('inv.saplings', 2);
      ws1.set('tree.active', false);

      const ws2 = lumberjackWithSaplingsState();
      ws2.set('inv.saplings', 10);
      ws2.set('tree.active', false);

      expect(plantGoal.getUtility(ws2)).toBeGreaterThan(plantGoal.getUtility(ws1));
    });

    test('SPEC: No planting during active harvest', () => {
      const ws = lumberjackWithSaplingsState();
      ws.set('tree.active', true);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No saplings = cannot plant', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('inv.saplings', 0);

      const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Wood Processing', () => {
    test('SPEC: Logs + low planks = should process (utility 50)', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 8);
      ws.set('inv.planks', 0);

      const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
      expect(processGoal.getUtility(ws)).toBe(50);
    });

    test('SPEC: Enough planks = no processing', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 8);
      ws.set('inv.planks', 8);

      const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
      expect(processGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Too few logs = cannot process', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 1);
      ws.set('inv.planks', 0);

      const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
      expect(processGoal.getUtility(ws)).toBe(0);
    });
  });
});
