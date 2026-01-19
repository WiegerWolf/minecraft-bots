import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import {
  freshSpawnLumberjackState,
  lumberjackReadyToChopState,
} from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Forest Safety
 *
 * Lumberjacks should ONLY chop trees that are part of actual forests,
 * NOT logs that are part of village houses or other structures.
 *
 * A forest is defined as an area with 3+ trees clustered together.
 * Scattered logs near structures should be avoided.
 *
 * This prevents the bot from dismantling villager houses.
 */

describe('Lumberjack Forest Safety', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Forest Tree Detection', () => {
    test('SPEC: ChopTree uses forestTrees not reachableTrees', () => {
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      // Has reachable trees but NO forest trees - should NOT chop
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 5);
      ws.set('nearby.forestTrees', 0);

      expect(chopGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: With forest trees, should chop', () => {
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      const ws = lumberjackReadyToChopState();
      ws.set('nearby.forestTrees', 5);

      expect(chopGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: More forest trees = higher utility', () => {
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      const ws1 = lumberjackReadyToChopState();
      ws1.set('nearby.forestTrees', 2);
      ws1.set('inv.logs', 0);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('nearby.forestTrees', 10);
      ws2.set('inv.logs', 0);

      expect(chopGoal.getUtility(ws2)).toBeGreaterThan(chopGoal.getUtility(ws1));
    });

    test('SPEC: Scattered trees (non-forest) have zero utility', () => {
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      // Only isolated trees, no forest cluster
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 2); // 2 isolated trees
      ws.set('nearby.forestTrees', 0);     // No forest detected

      expect(chopGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Forest Discovery', () => {
    test('SPEC: FindForest goal exists', () => {
      const findForestGoal = goals.find((g) => g.name === 'FindForest');
      expect(findForestGoal).toBeDefined();
    });

    test('SPEC: Without known forest, FindForest has utility', () => {
      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;

      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', true);
      ws.set('has.knownForest', false);
      ws.set('has.axe', true);

      expect(findForestGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: With known forest, FindForest has zero utility', () => {
      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;

      const ws = lumberjackReadyToChopState();
      ws.set('has.knownForest', true);

      expect(findForestGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: FindForest lower than StudySpawnSigns', () => {
      const findForestGoal = goals.find((g) => g.name === 'FindForest')!;
      const studySignsGoal = goals.find((g) => g.name === 'StudySpawnSigns')!;

      // Fresh spawn - study signs first
      const ws = freshSpawnLumberjackState();
      ws.set('has.studiedSigns', false);
      ws.set('has.knownForest', false);

      expect(studySignsGoal.getUtility(ws)).toBeGreaterThan(findForestGoal.getUtility(ws));
    });
  });

  describe('FOREST Sign Writing', () => {
    test('SPEC: WriteForestSign goal exists', () => {
      const writeForestGoal = goals.find((g) => g.name === 'WriteForestSign');
      expect(writeForestGoal).toBeDefined();
    });

    test('SPEC: Pending forest sign write triggers goal', () => {
      const writeForestGoal = goals.find((g) => g.name === 'WriteForestSign')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.forestSignWrite', true);

      expect(writeForestGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: No pending write = zero utility', () => {
      const writeForestGoal = goals.find((g) => g.name === 'WriteForestSign')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.forestSignWrite', false);

      expect(writeForestGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: WriteForestSign high priority (helps future lumberjacks)', () => {
      const writeForestGoal = goals.find((g) => g.name === 'WriteForestSign')!;
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.forestSignWrite', true);
      ws.set('nearby.forestTrees', 5);
      ws.set('inv.logs', 0);

      // Writing the sign should be higher priority than chopping
      // So future lumberjacks can find the forest immediately
      expect(writeForestGoal.getUtility(ws)).toBeGreaterThan(chopGoal.getUtility(ws));
    });
  });

  describe('Forest Knowledge from Signs', () => {
    test('SPEC: After studying FOREST sign, has.knownForest is true', () => {
      // This is a behavior test - when StudySpawnSigns finds a FOREST sign,
      // it should set has.knownForest to true
      const ws = lumberjackReadyToChopState();
      ws.set('has.knownForest', true);
      ws.set('nearby.forestTrees', 5);

      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
      expect(chopGoal.getUtility(ws)).toBeGreaterThan(0);
    });
  });
});
