import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackReadyToChopState,
  lumberjackStuckState,
  farmerIdleState,
  landscaperIdleState,
} from '../mocks';

/**
 * SPECIFICATION: Idle Behavior
 *
 * When bots have no urgent work, they should still be productive:
 * - Lumberjack: Patrol to find trees, read signs
 * - Farmer: Explore, gather seeds, read signs
 * - Landscaper: WAIT at spawn (not explore), gather dirt, craft slabs
 *
 * Key principle: Landscaper is reactive (waits for requests) while
 * lumberjack and farmer are proactive (explore).
 */

describe('Idle Behavior', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // LUMBERJACK PATROL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lumberjack Patrol', () => {
    const goals = createLumberjackGoals();

    test('SPEC: No trees = should patrol (utility 45)', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0);

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws)).toBe(45);
    });

    test('SPEC: Stuck state = patrol to unstick', () => {
      const ws = lumberjackStuckState();

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws)).toBeGreaterThan(50);
    });

    test('SPEC: Patrol utility increases with idle ticks', () => {
      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;

      const ws1 = lumberjackReadyToChopState();
      ws1.set('state.consecutiveIdleTicks', 4);
      ws1.set('nearby.reachableTrees', 1);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('state.consecutiveIdleTicks', 10);
      ws2.set('nearby.reachableTrees', 1);

      expect(patrolGoal.getUtility(ws2)).toBeGreaterThan(patrolGoal.getUtility(ws1));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FARMER EXPLORATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Farmer Exploration', () => {
    const goals = createFarmingGoals();

    test('SPEC: Idle triggers exploration', () => {
      const ws = farmerIdleState();
      ws.set('state.consecutiveIdleTicks', 10);

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.getUtility(ws)).toBeGreaterThan(15);
    });

    test('SPEC: More idle = higher explore utility', () => {
      const exploreGoal = goals.find((g) => g.name === 'Explore')!;

      const ws1 = farmerIdleState();
      ws1.set('state.consecutiveIdleTicks', 2);

      const ws2 = farmerIdleState();
      ws2.set('state.consecutiveIdleTicks', 20);

      expect(exploreGoal.getUtility(ws2)).toBeGreaterThan(exploreGoal.getUtility(ws1));
    });

    test('SPEC: Explore has lowest priority', () => {
      const ws = farmerIdleState();
      ws.set('state.consecutiveIdleTicks', 5);

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.getUtility(ws)).toBeLessThan(20);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LANDSCAPER WAITING (NOT EXPLORING)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Landscaper Waiting (Not Exploring)', () => {
    const goals = createLandscaperGoals();

    test('SPEC: Explore has zero utility (landscaper waits)', () => {
      // This is critical: landscaper waits at spawn for requests
      const ws = landscaperIdleState();

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Idle landscaper gathers dirt or crafts slabs', () => {
      const arbiter = new GoalArbiter(goals);
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 20);
      ws.set('inv.planks', 6);
      ws.set('has.shovel', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(['GatherDirt', 'CraftSlabs'].includes(result?.goal.name ?? '')).toBe(true);
    });

    test('SPEC: Don\'t gather during terraform work', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 10);
      ws.set('terraform.active', true);
      ws.set('has.shovel', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Don\'t craft slabs during terraform work', () => {
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 12);
      ws.set('terraform.active', true);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });
  });
});
