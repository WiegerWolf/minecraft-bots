import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import { freshSpawnFarmerState } from '../../mocks';

/**
 * SPECIFICATION: Farmer Follow-Lumberjack Behavior
 *
 * During the exploration phase (before village center is established),
 * the farmer should loosely follow the lumberjack to stay within
 * VillageChat range and hear about the village center location.
 *
 * Conditions for following:
 * - Has studied spawn signs (startup complete)
 * - No village center established yet
 * - Lumberjack is visible (in render distance)
 * - Lumberjack is more than 30 blocks away
 */

describe('Farmer Follow-Lumberjack', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);
  const followGoal = goals.find((g) => g.name === 'FollowLumberjack')!;

  describe('Goal Utility', () => {
    test('SPEC: Zero utility before studying signs', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', false);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 50);

      expect(followGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Zero utility when village exists', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', true);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 50);

      expect(followGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Zero utility when no lumberjack visible', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', false);
      ws.set('nearby.lumberjackDistance', -1);

      expect(followGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Zero utility when already close (within 30 blocks)', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 25);

      expect(followGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Positive utility when lumberjack is far (>30 blocks)', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 50);

      const utility = followGoal.getUtility(ws);
      expect(utility).toBeGreaterThan(0);
      expect(utility).toBeGreaterThanOrEqual(55);
    });

    test('SPEC: Higher utility when further away', () => {
      const ws1 = freshSpawnFarmerState();
      ws1.set('has.studiedSigns', true);
      ws1.set('derived.hasVillage', false);
      ws1.set('nearby.hasLumberjack', true);
      ws1.set('nearby.lumberjackDistance', 40);

      const ws2 = freshSpawnFarmerState();
      ws2.set('has.studiedSigns', true);
      ws2.set('derived.hasVillage', false);
      ws2.set('nearby.hasLumberjack', true);
      ws2.set('nearby.lumberjackDistance', 100);

      expect(followGoal.getUtility(ws2)).toBeGreaterThan(followGoal.getUtility(ws1));
    });

    test('SPEC: Utility capped at 70', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 500); // Very far

      expect(followGoal.getUtility(ws)).toBeLessThanOrEqual(70);
    });
  });

  describe('Goal Selection', () => {
    test('SPEC: FollowLumberjack selected when far from lumberjack during exploration', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 60);
      // Make sure no higher priority goals are active
      ws.set('nearby.drops', 0);
      ws.set('trade.status', '');
      ws.set('trade.inTrade', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FollowLumberjack');
    });

    test('SPEC: FollowLumberjack not selected when close to lumberjack', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 20); // Close enough
      ws.set('nearby.drops', 0);
      ws.set('trade.status', '');
      ws.set('trade.inTrade', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // FollowLumberjack should not be selected when already close
      // (farmer can do other things like GatherSeeds or Explore)
      expect(result?.goal.name).not.toBe('FollowLumberjack');
    });

    test('SPEC: Higher priority goals override FollowLumberjack', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 60);
      // Add drops - higher priority than following
      ws.set('nearby.drops', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
    });
  });

  describe('Exploration Phase Sequence', () => {
    test('SPEC: Farmer follows lumberjack until village center established', () => {
      const ws = freshSpawnFarmerState();

      // Step 1: Study signs first
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: After signs, lumberjack is far - follow them
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasVillage', false);
      ws.set('nearby.hasLumberjack', true);
      ws.set('nearby.lumberjackDistance', 80);
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal(); // Clear to avoid hysteresis
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('FollowLumberjack');

      // Step 3: Caught up to lumberjack - do other tasks
      ws.set('nearby.lumberjackDistance', 20);

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).not.toBe('FollowLumberjack');

      // Step 4: Lumberjack moves very far - must follow (utility > GatherSeeds)
      // At distance 150+, FollowLumberjack utility = 55 + 15 = 70, beating GatherSeeds (55)
      ws.set('nearby.lumberjackDistance', 200);

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('FollowLumberjack');

      // Step 5: Village center established - switch to farming
      ws.set('derived.hasVillage', true);
      ws.set('nearby.water', 3);

      arbiter.clearCurrentGoal();
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('EstablishFarm');
    });
  });
});
