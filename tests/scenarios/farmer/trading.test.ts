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
    test('SPEC: Pending trade offers = very high priority (utility 140)', () => {
      const ws = farmerWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      // Utility must be 140+ to preempt goals at ~100 (100 + 30 preemption threshold = 130)
      expect(result?.utility).toBeGreaterThanOrEqual(140);
    });

    test('SPEC: Trade offers preempt normal farming', () => {
      const ws = establishedFarmerState();
      ws.set('trade.pendingOffers', 2);
      ws.set('trade.canRespondToOffers', true);  // Computed boolean
      ws.set('nearby.matureCrops', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });

    test('SPEC: Trade offers can preempt any non-trade activity (utility > max_activity + 30)', () => {
      // The preemption threshold is 30, so for a bot doing HarvestCrops at utility ~100,
      // RespondToTradeOffer needs utility > 130 to interrupt
      const ws = farmerWithTradeOffersState();

      const respondGoal = goals.find((g) => g.name === 'RespondToTradeOffer')!;
      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;

      // Set up state where harvesting is viable
      ws.set('nearby.matureCrops', 10);
      ws.set('state.inventoryFull', false);

      const respondUtility = respondGoal.getUtility(ws);
      const harvestUtility = harvestGoal.getUtility(ws);

      // RespondToTradeOffer must be able to preempt HarvestCrops (utility + 30)
      expect(respondUtility).toBeGreaterThan(harvestUtility + 30);
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
      ws.set('trade.canBroadcastOffer', false);  // Computed boolean

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Cannot broadcast on cooldown', () => {
      const ws = farmerWithTradeableItemsState();
      ws.set('trade.onCooldown', true);
      ws.set('trade.canBroadcastOffer', false);  // Computed boolean

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });
});
