import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import { lumberjackNeedsToDepositState, lumberjackReadyToChopState } from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Inventory Management
 *
 * Lumberjacks must manage inventory:
 * - Collect drops before despawn (urgent)
 * - Deposit logs at thresholds
 * - Farmer request increases urgency
 */

describe('Lumberjack Inventory', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Drop Collection', () => {
    test('SPEC: Drops preempt tree chopping', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 3);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.utility).toBeGreaterThan(100);
    });

    test('SPEC: More drops = higher urgency (capped at 150)', () => {
      const ws1 = lumberjackReadyToChopState();
      ws1.set('nearby.drops', 1);
      arbiter.clearCurrentGoal();
      const result1 = arbiter.selectGoal(ws1);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('nearby.drops', 5);
      arbiter.clearCurrentGoal();
      const result2 = arbiter.selectGoal(ws2);

      expect(result2?.utility).toBeGreaterThan(result1?.utility ?? 0);
      expect(result2?.utility).toBeLessThanOrEqual(150);
    });

    test('SPEC: No drops = zero utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 0);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Drops interrupt work then resume', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 10);

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');

      // Drops appear
      ws.set('nearby.drops', 4);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');

      // Drops collected
      ws.set('nearby.drops', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');
    });
  });

  describe('Log Deposit', () => {
    test('SPEC: Full inventory forces deposit (utility 90)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('state.inventoryFull', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositLogs');
      expect(result?.utility).toBe(90);
    });

    test('SPEC: 32+ logs = high priority (80)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 32);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(80);
    });

    test('SPEC: 16+ logs = medium priority (70)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 16);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: 8+ logs = low priority (60)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 8);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(60);
    });

    test('SPEC: <5 logs = no deposit (utility 0)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 4);
      ws.set('state.inventoryFull', false);
      ws.set('has.pendingRequests', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Incoming need increases urgency (85)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 8);
      ws.set('has.incomingNeeds', true);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(85);
    });

    test('SPEC: No storage = cannot deposit', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 64);
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });
});
