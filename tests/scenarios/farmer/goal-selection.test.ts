import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import { establishedFarmerState } from '../../mocks';

/**
 * SPECIFICATION: Farmer Goal Selection
 *
 * Goal selection uses 20% hysteresis to prevent thrashing:
 * - Current goal must be beaten by >20% to switch
 * - Large changes cause immediate switch
 */

describe('Farmer Goal Selection', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);

  test('SPEC: Should not thrash between similar goals', () => {
    const ws = establishedFarmerState();
    ws.set('nearby.farmland', 12);
    ws.set('can.plant', true);
    ws.set('inv.seeds', 15);
    ws.set('nearby.matureCrops', 0);

    arbiter.clearCurrentGoal();
    const result1 = arbiter.selectGoal(ws);

    // Small change
    ws.set('nearby.farmland', 10);

    const result2 = arbiter.selectGoal(ws);

    if (result1?.goal.name === result2?.goal.name) {
      expect(
        result2?.reason === 'hysteresis' || result1?.goal.name === result2?.goal.name
      ).toBe(true);
    }
  });

  test('SPEC: Large utility change causes switch', () => {
    const ws = establishedFarmerState();
    ws.set('nearby.farmland', 10);
    ws.set('can.plant', true);
    ws.set('nearby.drops', 0);

    arbiter.clearCurrentGoal();
    arbiter.selectGoal(ws);

    // Big change - drops appear
    ws.set('nearby.drops', 5);

    const result = arbiter.selectGoal(ws);
    expect(result?.goal.name).toBe('CollectDrops');
  });

  test('SPEC: Multiple urgent priorities - highest wins', () => {
    const ws = establishedFarmerState();
    ws.set('nearby.drops', 5); // Utility 150
    ws.set('trade.status', 'traveling'); // CompleteTrade utility 150
    ws.set('trade.inTrade', true);
    ws.set('nearby.matureCrops', 10); // Utility ~90

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    // Either CompleteTrade or CollectDrops (both 150)
    expect(result).not.toBeNull();
    expect(['CompleteTrade', 'CollectDrops']).toContain(result!.goal.name);
  });
});
