import { describe, test, expect, mock } from 'bun:test';
import { PlanExecutor, ReplanReason } from '../../src/planning/PlanExecutor';
import { ActionResult } from '../../src/planning/Action';
import { WorldState } from '../../src/planning/WorldState';
import { createBotMock, createFarmingBlackboardMock, createMockAction } from '../mocks';

describe('PlanExecutor', () => {
  const createExecutor = (onReplan = () => {}) => {
    const bot = createBotMock();
    const bb = createFarmingBlackboardMock();
    return new PlanExecutor(bot as any, bb as any, onReplan);
  };

  describe('loadPlan', () => {
    test('loads plan and resets state', () => {
      const executor = createExecutor();
      const action1 = createMockAction({ name: 'Action1' });
      const action2 = createMockAction({ name: 'Action2' });

      const ws = new WorldState();
      executor.loadPlan([action1, action2], ws);

      expect(executor.isExecuting()).toBe(true);
      expect(executor.isComplete()).toBe(false);
      expect(executor.getProgress()).toBe(0);
    });

    test('handles empty plan', () => {
      const executor = createExecutor();
      const ws = new WorldState();
      executor.loadPlan([], ws);

      expect(executor.isExecuting()).toBe(false);
    });
  });

  describe('tick execution', () => {
    test('executes actions in sequence', async () => {
      const executor = createExecutor();
      const executionOrder: string[] = [];

      const action1 = createMockAction({
        name: 'Action1',
        executeFn: async () => {
          executionOrder.push('Action1');
          return ActionResult.SUCCESS;
        },
      });

      const action2 = createMockAction({
        name: 'Action2',
        executeFn: async () => {
          executionOrder.push('Action2');
          return ActionResult.SUCCESS;
        },
      });

      const ws = new WorldState();
      executor.loadPlan([action1, action2], ws);

      // First tick: starts and completes Action1
      await executor.tick(ws);
      expect(executionOrder).toEqual(['Action1']);

      // Second tick: starts and completes Action2
      await executor.tick(ws);
      expect(executionOrder).toEqual(['Action1', 'Action2']);
    });

    test('handles RUNNING actions across multiple ticks', async () => {
      const executor = createExecutor();
      let callCount = 0;

      const runningAction = createMockAction({
        name: 'RunningAction',
        executeFn: async () => {
          callCount++;
          if (callCount < 3) {
            return ActionResult.RUNNING;
          }
          return ActionResult.SUCCESS;
        },
      });

      const ws = new WorldState();
      executor.loadPlan([runningAction], ws);

      // First two ticks: RUNNING
      await executor.tick(ws);
      expect(executor.getCurrentAction()?.name).toBe('RunningAction');

      await executor.tick(ws);
      expect(executor.getCurrentAction()?.name).toBe('RunningAction');

      // Third tick: SUCCESS
      await executor.tick(ws);
      expect(callCount).toBe(3);
    });

    test('tracks statistics correctly', async () => {
      const executor = createExecutor();

      const successAction = createMockAction({
        name: 'Success',
        executeResult: ActionResult.SUCCESS,
      });

      const failAction = createMockAction({
        name: 'Fail',
        executeResult: ActionResult.FAILURE,
      });

      const ws = new WorldState();
      executor.loadPlan([successAction, failAction], ws);

      await executor.tick(ws); // Success
      await executor.tick(ws); // Fail

      const stats = executor.getStats();
      expect(stats.actionsExecuted).toBe(2);
      expect(stats.actionsSucceeded).toBe(1);
      expect(stats.actionsFailed).toBe(1);
    });
  });

  describe('failure handling', () => {
    test('requests replan after max consecutive failures', async () => {
      let replanReason: ReplanReason | null = null;
      const executor = createExecutor((reason) => {
        replanReason = reason;
      });

      const failingAction = createMockAction({
        name: 'Failing',
        executeResult: ActionResult.FAILURE,
      });

      const ws = new WorldState();
      // Create plan with 5 copies of the failing action
      executor.loadPlan(
        Array(5).fill(null).map(() => failingAction),
        ws
      );

      // Default maxFailures is 3
      await executor.tick(ws); // Fail 1
      await executor.tick(ws); // Fail 2
      expect(replanReason).toBeNull();

      await executor.tick(ws); // Fail 3 - should trigger replan
      expect(replanReason).toBe(ReplanReason.ACTION_FAILED);
    });

    test('resets failure count on success', async () => {
      let replanCalled = false;
      const executor = createExecutor(() => {
        replanCalled = true;
      });

      let shouldFail = true;
      const action = createMockAction({
        name: 'Intermittent',
        executeFn: async () => {
          if (shouldFail) {
            shouldFail = false;
            return ActionResult.FAILURE;
          }
          return ActionResult.SUCCESS;
        },
      });

      const ws = new WorldState();
      // Create many actions
      executor.loadPlan(Array(10).fill(action), ws);

      // Fail, then succeed (resets counter), fail, succeed, etc.
      // Should never hit 3 consecutive failures
      for (let i = 0; i < 6; i++) {
        shouldFail = i % 2 === 0;
        await executor.tick(ws);
      }

      expect(replanCalled).toBe(false);
    });

    test('hadRecentFailures reflects failure state', async () => {
      const executor = createExecutor();

      const failAction = createMockAction({
        name: 'Fail',
        executeResult: ActionResult.FAILURE,
      });

      const ws = new WorldState();
      executor.loadPlan([failAction, failAction], ws);

      expect(executor.hadRecentFailures()).toBe(false);

      await executor.tick(ws); // Fail
      expect(executor.hadRecentFailures()).toBe(true);
    });
  });

  describe('world state change detection', () => {
    test('requests replan when world changes significantly', async () => {
      let replanReason: ReplanReason | null = null;
      const executor = createExecutor((reason) => {
        replanReason = reason;
      });

      const runningAction = createMockAction({
        name: 'Running',
        executeResult: ActionResult.RUNNING,
      });

      const initialWs = new WorldState();
      initialWs.set('inv.seeds', 10);
      initialWs.set('inv.produce', 5);
      initialWs.set('nearby.drops', 0);
      initialWs.set('has.hoe', true);
      initialWs.set('nearby.water', 1);

      executor.loadPlan([runningAction], initialWs);
      await executor.tick(initialWs);

      // Simulate significant world change (5+ facts different)
      const changedWs = new WorldState();
      changedWs.set('inv.seeds', 50); // Changed
      changedWs.set('inv.produce', 20); // Changed
      changedWs.set('nearby.drops', 5); // Changed
      changedWs.set('has.hoe', false); // Changed
      changedWs.set('nearby.water', 0); // Changed

      executor.checkWorldStateChange(changedWs);
      expect(replanReason).toBe(ReplanReason.WORLD_CHANGED);
    });

    test('does not replan for minor changes', async () => {
      let replanReason: ReplanReason | null = null;
      const executor = createExecutor((reason) => {
        replanReason = reason;
      });

      const runningAction = createMockAction({
        name: 'Running',
        executeResult: ActionResult.RUNNING,
      });

      const initialWs = new WorldState();
      initialWs.set('inv.seeds', 10);
      initialWs.set('inv.produce', 5);

      executor.loadPlan([runningAction], initialWs);
      await executor.tick(initialWs);

      // Minor change (less than 5 facts)
      const changedWs = new WorldState();
      changedWs.set('inv.seeds', 11); // Changed
      changedWs.set('inv.produce', 5); // Same

      executor.checkWorldStateChange(changedWs);
      expect(replanReason).toBeNull();
    });
  });

  describe('plan exhaustion', () => {
    test('triggers replan when plan completes', async () => {
      let replanReason: ReplanReason | null = null;
      const executor = createExecutor((reason) => {
        replanReason = reason;
      });

      const action = createMockAction({
        name: 'Quick',
        executeResult: ActionResult.SUCCESS,
      });

      const ws = new WorldState();
      executor.loadPlan([action], ws);

      await executor.tick(ws); // Complete action
      await executor.tick(ws); // Plan exhausted

      expect(replanReason).toBe(ReplanReason.PLAN_EXHAUSTED);
    });
  });

  describe('cancellation', () => {
    test('cancel triggers replan', () => {
      let replanReason: ReplanReason | null = null;
      const executor = createExecutor((reason) => {
        replanReason = reason;
      });

      const action = createMockAction({ name: 'Action' });
      const ws = new WorldState();
      executor.loadPlan([action], ws);

      executor.cancel(ReplanReason.WORLD_CHANGED);

      expect(replanReason).toBe(ReplanReason.WORLD_CHANGED);
      expect(executor.isExecuting()).toBe(false);
    });

    test('calls action cancel method when available', async () => {
      let cancelCalled = false;
      const executor = createExecutor();

      const action = createMockAction({
        name: 'Cancellable',
        executeResult: ActionResult.RUNNING,
      });
      action.cancel = () => {
        cancelCalled = true;
      };

      const ws = new WorldState();
      executor.loadPlan([action], ws);
      await executor.tick(ws); // Start action

      executor.cancel();

      expect(cancelCalled).toBe(true);
    });
  });

  describe('status and progress', () => {
    test('getProgress returns correct percentage', async () => {
      const executor = createExecutor();

      const actions = [
        createMockAction({ name: 'A1', executeResult: ActionResult.SUCCESS }),
        createMockAction({ name: 'A2', executeResult: ActionResult.SUCCESS }),
        createMockAction({ name: 'A3', executeResult: ActionResult.SUCCESS }),
        createMockAction({ name: 'A4', executeResult: ActionResult.SUCCESS }),
      ];

      const ws = new WorldState();
      executor.loadPlan(actions, ws);

      expect(executor.getProgress()).toBe(0);

      await executor.tick(ws); // Complete A1
      expect(executor.getProgress()).toBe(25);

      await executor.tick(ws); // Complete A2
      expect(executor.getProgress()).toBe(50);

      await executor.tick(ws); // Complete A3
      expect(executor.getProgress()).toBe(75);

      await executor.tick(ws); // Complete A4
      expect(executor.getProgress()).toBe(100);
    });

    test('getStatus returns readable status', async () => {
      const executor = createExecutor();

      const action = createMockAction({
        name: 'TestAction',
        executeResult: ActionResult.RUNNING,
      });

      expect(executor.getStatus()).toBe('idle');

      const ws = new WorldState();
      executor.loadPlan([action, action], ws);
      await executor.tick(ws);

      expect(executor.getStatus()).toContain('executing');
      expect(executor.getStatus()).toContain('TestAction');
      expect(executor.getStatus()).toContain('1/2');
    });
  });

  describe('resetStats', () => {
    test('clears all statistics', async () => {
      const executor = createExecutor();

      const action = createMockAction({
        name: 'Action',
        executeResult: ActionResult.SUCCESS,
      });

      const ws = new WorldState();
      executor.loadPlan([action], ws);
      await executor.tick(ws);

      const statsBefore = executor.getStats();
      expect(statsBefore.actionsExecuted).toBe(1);

      executor.resetStats();

      const statsAfter = executor.getStats();
      expect(statsAfter.actionsExecuted).toBe(0);
      expect(statsAfter.actionsSucceeded).toBe(0);
      expect(statsAfter.actionsFailed).toBe(0);
      expect(statsAfter.replansRequested).toBe(0);
    });
  });
});
