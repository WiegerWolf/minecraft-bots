import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import { landscaperIdleState, landscaperReadyToWorkState } from '../../mocks';

/**
 * SPECIFICATION: Landscaper Idle Behavior
 *
 * Critical difference from other roles:
 * - Landscaper does NOT explore
 * - Landscaper WAITS for requests
 * - Utility when truly idle should be very low
 */

describe('Landscaper Idle Behavior', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Wait vs Explore', () => {
    test('SPEC: Idle landscaper has LOW utility (waits for requests)', () => {
      const ws = landscaperIdleState();
      ws.set('state.farmsNeedingCheck', 0);
      ws.set('inv.dirt', 64);
      ws.set('has.pendingTerraformRequest', false);
      ws.set('terraform.active', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // When truly idle, utility should be low - landscaper waits
      expect(result?.utility ?? 0).toBeLessThan(50);
    });

    test('SPEC: Landscaper Explore goal has low utility (waiting behavior)', () => {
      // Landscapers have Explore but it's just a "wait at spawn" behavior
      const exploreGoal = goals.find((g) => g.name === 'Explore');
      expect(exploreGoal).toBeDefined();
      expect(exploreGoal!.description).toContain('Wait');

      const ws = landscaperIdleState();
      ws.set('state.consecutiveIdleTicks', 10);
      // Explore utility should be low - landscaper waits, doesn't actively explore
      expect(exploreGoal!.getUtility(ws)).toBeLessThan(30);
    });

    test('SPEC: Ready state with no work = minimal activity', () => {
      const ws = landscaperReadyToWorkState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('terraform.active', false);
      ws.set('state.farmsNeedingCheck', 0);
      ws.set('state.farmsWithIssues', 0);
      ws.set('inv.dirt', 64);
      ws.set('inv.slabs', 20);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should pick something very low priority or nothing
      expect(result?.utility ?? 0).toBeLessThan(50);
    });
  });

  describe('Proactive Tasks When Idle', () => {
    test('SPEC: Can gather dirt proactively when low', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 10);
      ws.set('has.shovel', true);
      ws.set('terraform.active', false);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('SPEC: Can craft slabs proactively when low', () => {
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 12);
      ws.set('terraform.active', false);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBeGreaterThan(20);
    });

    test('SPEC: Can check farms proactively', () => {
      const ws = landscaperIdleState();
      ws.set('state.farmsNeedingCheck', 2);
      ws.set('terraform.active', false);

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBeGreaterThan(40);
    });
  });

  describe('Request Response', () => {
    test('SPEC: Terraform request immediately activates landscaper', () => {
      const ws = landscaperIdleState();
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.shovel', true);
      ws.set('has.pickaxe', true);
      ws.set('derived.hasAnyTool', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
      expect(result?.utility).toBe(100);
    });

    test('SPEC: Trade offer interrupts idle state', () => {
      const ws = landscaperIdleState();
      ws.set('trade.pendingOffers', 1);
      ws.set('trade.canRespondToOffers', true);  // Computed boolean
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });
  });
});
