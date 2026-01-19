import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import {
  landscaperInActiveTradeState,
  landscaperWithTradeOffersState,
  landscaperWithTradeableItemsState,
  landscaperIdleState,
} from '../../mocks';

/**
 * SPECIFICATION: Landscaper Trading Behavior
 */

describe('Landscaper Trading', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Active Trade Completion', () => {
    test('SPEC: Active trade = highest priority (utility 150)', () => {
      const ws = landscaperInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });
  });

  describe('Responding to Offers', () => {
    test('SPEC: Pending trade offers = high priority (utility 120)', () => {
      const ws = landscaperWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('SPEC: Trade offer interrupts idle landscaper', () => {
      const ws = landscaperIdleState();
      ws.set('trade.pendingOffers', 2);
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });
  });

  describe('Broadcasting Offers', () => {
    test('SPEC: Tradeable items when idle can broadcast', () => {
      const ws = landscaperWithTradeableItemsState();

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('SPEC: Cannot broadcast on cooldown', () => {
      const ws = landscaperWithTradeableItemsState();
      ws.set('trade.onCooldown', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Cannot broadcast if already in trade', () => {
      const ws = landscaperWithTradeableItemsState();
      ws.set('trade.inTrade', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });
});
