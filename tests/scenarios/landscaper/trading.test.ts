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
    test('SPEC: Pending trade offers = very high priority (utility 140)', () => {
      const ws = landscaperWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      // Utility must be 140+ to preempt goals at ~100 (100 + 30 preemption threshold = 130)
      expect(result?.utility).toBeGreaterThanOrEqual(140);
    });

    test('SPEC: Trade offer interrupts idle landscaper', () => {
      const ws = landscaperIdleState();
      ws.set('trade.pendingOffers', 2);
      ws.set('trade.canRespondToOffers', true);  // Computed boolean
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });

    test('SPEC: Trade offers can preempt terraforming work', () => {
      const ws = landscaperWithTradeOffersState();

      const respondGoal = goals.find((g) => g.name === 'RespondToTradeOffer')!;
      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;

      // Set up state where terraforming is needed
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.shovel', true);

      const respondUtility = respondGoal.getUtility(ws);
      const terraformUtility = terraformGoal.getUtility(ws);

      // RespondToTradeOffer must be able to preempt terraform (utility + 30)
      expect(respondUtility).toBeGreaterThan(terraformUtility + 30);
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
      ws.set('trade.canBroadcastOffer', false);  // Computed boolean

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Cannot broadcast if already in trade', () => {
      const ws = landscaperWithTradeableItemsState();
      ws.set('trade.inTrade', true);
      ws.set('trade.canBroadcastOffer', false);  // Computed boolean

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });
});
