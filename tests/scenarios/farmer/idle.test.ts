import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import { farmerIdleState, establishedFarmerState } from '../../mocks';

/**
 * SPECIFICATION: Farmer Idle Behavior
 *
 * When farmers have no urgent work:
 * - Explore to find resources
 * - Utility increases with idle time
 * - Explore is always valid (fallback)
 */

describe('Farmer Idle', () => {
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

  test('SPEC: Explore is always valid (fallback)', () => {
    const ws = establishedFarmerState();

    const exploreGoal = goals.find((g) => g.name === 'Explore')!;
    expect(exploreGoal.isValid(ws)).toBe(true);
  });
});
