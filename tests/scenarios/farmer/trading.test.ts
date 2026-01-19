import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import {
  farmerInActiveTradeState,
  farmerWithTradeOffersState,
  farmerWithTradeableItemsState,
  establishedFarmerState,
} from '../../mocks';

/**
 * SPECIFICATION: Farmer Trading Behavior
 *
 * Farmers participate in the village trading protocol:
 * - Complete active trades (highest priority)
 * - Respond to trade offers for items they want
 * - Broadcast offers for unwanted items when idle
 */

describe('Farmer Trading', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Active Trade Completion', () => {
    test('SPEC: Active trade = highest priority (utility 150)', () => {
      const ws = farmerInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });
  });

  describe('Responding to Offers', () => {
    test('SPEC: Pending trade offers = high priority (utility 120)', () => {
      const ws = farmerWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('SPEC: Trade offers preempt normal farming', () => {
      const ws = establishedFarmerState();
      ws.set('trade.pendingOffers', 2);
      ws.set('nearby.matureCrops', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });
  });

  describe('Broadcasting Offers', () => {
    test('SPEC: Idle with tradeable items can broadcast', () => {
      const ws = farmerWithTradeableItemsState();

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('SPEC: Cannot broadcast if already in trade', () => {
      const ws = farmerWithTradeableItemsState();
      ws.set('trade.inTrade', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Cannot broadcast on cooldown', () => {
      const ws = farmerWithTradeableItemsState();
      ws.set('trade.onCooldown', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });
});
