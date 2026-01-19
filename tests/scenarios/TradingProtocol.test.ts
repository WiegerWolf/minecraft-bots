import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackInActiveTradeState,
  lumberjackWithTradeOffersState,
  lumberjackWithTradeableItemsState,
  lumberjackReadyToChopState,
  farmerInActiveTradeState,
  farmerWithTradeOffersState,
  farmerWithTradeableItemsState,
  establishedFarmerState,
  landscaperInActiveTradeState,
  landscaperWithTradeOffersState,
  landscaperWithTradeableItemsState,
  landscaperIdleState,
} from '../mocks';

/**
 * SPECIFICATION: Trading Protocol
 *
 * Bots can trade items with each other using a hand-to-hand exchange protocol.
 * The protocol involves:
 * 1. Broadcasting offers (OFFER message)
 * 2. Responding to offers (WANT message)
 * 3. Meeting at a location
 * 4. Exchanging items
 *
 * Key invariants:
 * - Active trades MUST be completed (partner is waiting)
 * - Only one trade at a time
 * - Cooldown between broadcasts to prevent spam
 * - Minimum tradeable count (4) to avoid trivial trades
 */

describe('Trading Protocol', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE TRADE COMPLETION - HIGHEST PRIORITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Active Trade Completion', () => {
    test('SPEC: Lumberjack completes active trade (utility 150)', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('SPEC: Farmer completes active trade (utility 150)', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = farmerInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('SPEC: Landscaper completes active trade (utility 150)', () => {
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = landscaperInActiveTradeState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('SPEC: Active trade preempts normal work', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackInActiveTradeState();
      ws.set('nearby.reachableTrees', 10);
      ws.set('has.pendingRequests', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CompleteTrade');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONDING TO TRADE OFFERS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Responding to Trade Offers', () => {
    test('SPEC: Lumberjack responds to offers (utility 120)', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('SPEC: Farmer responds to offers (utility 120)', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = farmerWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('SPEC: Landscaper responds to offers (utility 120)', () => {
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = landscaperWithTradeOffersState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
      expect(result?.utility).toBe(120);
    });

    test('SPEC: Trade offers preempt normal farming', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = establishedFarmerState();
      ws.set('trade.pendingOffers', 2);
      ws.set('nearby.matureCrops', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BROADCASTING TRADE OFFERS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Broadcasting Trade Offers', () => {
    describe('Lumberjack', () => {
      const goals = createLumberjackGoals();

      test('SPEC: Can broadcast with 4+ tradeable items', () => {
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

      test('SPEC: Cannot broadcast with < 4 tradeable items', () => {
        const ws = lumberjackWithTradeableItemsState();
        ws.set('trade.tradeableCount', 3);

        const tradeGoal = goals.find((g) => g.name === 'BroadcastTradeOffer')!;
        expect(tradeGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Farmer', () => {
      const goals = createFarmingGoals();

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

    describe('Landscaper', () => {
      const goals = createLandscaperGoals();

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

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADE INTERRUPTION SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Trade Interruption Scenarios', () => {
    test('SPEC: Trade offer interrupts idle landscaper', () => {
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = landscaperIdleState();
      ws.set('trade.pendingOffers', 2);
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });

    test('SPEC: Lumberjack can trade during idle period', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
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

      // PatrolForest or BroadcastTradeOffer when truly idle
      expect(['PatrolForest', 'BroadcastTradeOffer'].includes(result?.goal.name ?? '')).toBe(
        true
      );
    });
  });
});
