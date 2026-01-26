import { describe, test, expect } from 'bun:test';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import { freshSpawnLumberjackState, lumberjackReadyToChopState } from '../../mocks';

/**
 * SPECIFICATION: Water Crossing Requires Boat
 *
 * When the lumberjack needs to cross large bodies of water (>20 blocks):
 * - Without a boat: exploration actions (FindForest, PatrolForest) are blocked
 * - With a boat: exploration actions are allowed
 *
 * This prevents the lumberjack from swimming across oceans to find forests.
 * Instead, they must find forests on land first, and only explore across water
 * once they have a boat (acquired from trades, chests, or crafting).
 *
 * Short water crossings (<20 blocks) are still allowed without a boat.
 */

describe('Lumberjack Water Crossing', () => {
  const goals = createLumberjackGoals();

  describe('FindForest goal', () => {
    test('SPEC: Without boat + large water ahead = FindForest is invalid', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.knownForest', false);
      ws.set('has.boat', false);
      ws.set('exploration.minWaterAhead', 25); // 25 blocks of water ahead

      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;
      expect(findForestGoal.isValid(ws)).toBe(false);
    });

    test('SPEC: With boat + large water ahead = FindForest is valid', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.knownForest', false);
      ws.set('has.boat', true);
      ws.set('exploration.minWaterAhead', 25); // 25 blocks of water ahead

      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;
      expect(findForestGoal.isValid(ws)).toBe(true);
    });

    test('SPEC: Without boat + small water = FindForest is valid (can swim short distances)', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.knownForest', false);
      ws.set('has.boat', false);
      ws.set('exploration.minWaterAhead', 15); // Only 15 blocks - swimable

      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;
      expect(findForestGoal.isValid(ws)).toBe(true);
    });

    test('SPEC: Without boat + no water = FindForest is valid', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.knownForest', false);
      ws.set('has.boat', false);
      ws.set('exploration.minWaterAhead', 0); // No water

      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;
      expect(findForestGoal.isValid(ws)).toBe(true);
    });
  });

  describe('PatrolForest goal', () => {
    test('SPEC: Without boat + large water ahead = PatrolForest utility is 0', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0); // No trees, would normally patrol
      ws.set('has.boat', false);
      ws.set('exploration.minWaterAhead', 30); // Large water body

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: With boat + large water ahead = PatrolForest has normal utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0); // No trees
      ws.set('has.boat', true);
      ws.set('exploration.minWaterAhead', 30);

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: Without boat + small water = PatrolForest has normal utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 0);
      ws.set('has.boat', false);
      ws.set('exploration.minWaterAhead', 10); // Small water - swimable

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.getUtility(ws)).toBeGreaterThan(0);
    });
  });

  describe('Water threshold constant', () => {
    test('SPEC: Threshold is 20 blocks (boundary test at 19 vs 21)', () => {
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.knownForest', false);
      ws.set('has.boat', false);

      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;

      // 19 blocks should be allowed (under threshold)
      ws.set('exploration.minWaterAhead', 19);
      expect(findForestGoal.isValid(ws)).toBe(true);

      // 21 blocks should be blocked (over threshold)
      ws.set('exploration.minWaterAhead', 21);
      expect(findForestGoal.isValid(ws)).toBe(false);

      // Exactly 20 blocks should be blocked (at threshold)
      ws.set('exploration.minWaterAhead', 20);
      expect(findForestGoal.isValid(ws)).toBe(false);
    });
  });
});
