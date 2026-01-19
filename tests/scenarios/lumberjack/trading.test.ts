import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import {
  lumberjackInActiveTradeState,
  lumberjackWithTradeOffersState,
  lumberjackWithTradeableItemsState,
  lumberjackReadyToChopState,
} from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Trading Behavior
 */

describe('Lumberjack Trading', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Active Trade Completion', () => {
    test('SPEC: Active trade = highest priority (utility 150)', () => {
      const ws = lumberjackInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('SPEC: Active trade preempts everything', () => {
      const ws = lumberjackInActiveTradeState();
      ws.set('nearby.reachableTrees', 10);
      ws.set('has.pendingRequests', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
    });
  });

  describe('Responding to Offers', () => {
    test('SPEC: Pending trade offers = high priority (utility 120)', () => {
      const ws = lumberjackWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });
  });

  describe('Broadcasting Offers', () => {
    test('SPEC: With 4+ tradeable items and idle, can broadcast', () => {
      const ws = lumberjackWithTradeableItemsState();
      ws.set('nearby.reachableTrees', 0);
      ws.set('state.consecutiveIdleTicks', 5);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('SPEC: Cannot broadcast if already in trade', () => {
      const ws = lumberjackWithTradeableItemsState();
      ws.set('trade.inTrade', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Cannot broadcast on cooldown', () => {
      const ws = lumberjackWithTradeableItemsState();
      ws.set('trade.onCooldown', true);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Less than 4 tradeable items = zero utility', () => {
      const ws = lumberjackWithTradeableItemsState();
      ws.set('trade.tradeableCount', 3);

      const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
      expect(tradeGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Trading During Idle', () => {
    test('SPEC: Can trade when truly idle', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 10);
      ws.set('state.consecutiveIdleTicks', 5);
      ws.set('trade.tradeableCount', 8);
      ws.set('trade.inTrade', false);
      ws.set('trade.onCooldown', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(['PatrolForest', 'BroadcastTradeOffer'].includes(result?.goal.name ?? '')).toBe(
        true
      );
    });
  });
});
