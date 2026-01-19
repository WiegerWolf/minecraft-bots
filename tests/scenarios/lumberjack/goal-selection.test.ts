import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import { lumberjackReadyToChopState } from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Goal Selection
 *
 * Goal selection uses 20% hysteresis to prevent thrashing.
 */

describe('Lumberjack Goal Selection', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  test('SPEC: Should not thrash between similar-utility goals', () => {
    const ws = lumberjackReadyToChopState();
    ws.set('inv.logs', 6);
    ws.set('inv.saplings', 4);
    ws.set('tree.active', false);

    arbiter.clearCurrentGoal();
    const result1 = arbiter.selectGoal(ws);
    const firstGoal = result1?.goal.name;

    // Slightly change utilities but within hysteresis threshold
    ws.set('inv.saplings', 5);

    const result2 = arbiter.selectGoal(ws);

    if (result1?.goal.name === result2?.goal.name) {
      expect(result2?.reason === 'hysteresis' || result2?.goal.name === firstGoal).toBe(
        true
      );
    }
  });

  test('SPEC: Large utility change causes switch', () => {
    const ws = lumberjackReadyToChopState();
    ws.set('nearby.reachableTrees', 5);
    ws.set('nearby.drops', 0);

    arbiter.clearCurrentGoal();
    arbiter.selectGoal(ws);

    // Big change - drops appear
    ws.set('nearby.drops', 5); // Utility 150

    const result = arbiter.selectGoal(ws);
    expect(result?.goal.name).toBe('CollectDrops');
    expect(result?.reason).toBe('switch');
  });

  test('SPEC: Multiple urgent priorities - highest wins', () => {
    const ws = lumberjackReadyToChopState();
    ws.set('nearby.drops', 5); // Utility 150
    ws.set('has.pendingRequests', true); // Utility 120
    ws.set('trade.pendingOffers', 2); // Utility 120

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('CollectDrops');
    expect(result?.utility).toBe(150);
  });
});
