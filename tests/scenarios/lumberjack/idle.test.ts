import { describe, test, expect } from 'bun:test';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import { lumberjackReadyToChopState, lumberjackStuckState } from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Idle Behavior
 *
 * When lumberjacks have no urgent work:
 * - Patrol to find trees
 * - Utility increases with idle time
 * - Patrol is always valid (fallback)
 */

describe('Lumberjack Idle', () => {
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

  test('SPEC: Patrol is always valid (fallback)', () => {
    const ws = lumberjackReadyToChopState();

    const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
    expect(patrolGoal.isValid(ws)).toBe(true);
  });
});
