import { describe, test, expect } from 'bun:test';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import {
  lumberjackWithPendingSignsState,
  lumberjackReadyToChopState,
  lumberjackWithUnknownSignsState,
} from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Knowledge Persistence
 *
 * Lumberjacks persist knowledge via signs:
 * - Write signs after placing infrastructure
 * - Investigate unknown signs
 */

describe('Lumberjack Knowledge', () => {
  const goals = createLumberjackGoals();

  describe('Sign Writing', () => {
    test('SPEC: Pending sign writes should be addressed', () => {
      const ws = lumberjackWithPendingSignsState();

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: More pending writes = higher priority', () => {
      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;

      const ws1 = lumberjackWithPendingSignsState();
      ws1.set('pending.signWrites', 1);

      const ws2 = lumberjackWithPendingSignsState();
      ws2.set('pending.signWrites', 3);

      expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
    });

    test('SPEC: No pending writes = zero utility', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 0);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      expect(signGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Unknown Sign Reading', () => {
    test('SPEC: Should investigate unknown signs', () => {
      const ws = lumberjackWithUnknownSignsState();

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      expect(signGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: More unknown signs = slightly higher priority', () => {
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

      const ws1 = lumberjackWithUnknownSignsState();
      ws1.set('nearby.unknownSigns', 1);

      const ws2 = lumberjackWithUnknownSignsState();
      ws2.set('nearby.unknownSigns', 3);

      expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
    });

    test('SPEC: Sign reading lower priority than core work', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.unknownSigns', 2);
      ws.set('nearby.reachableTrees', 5);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      expect(chopGoal.getUtility(ws)).toBeGreaterThan(signGoal.getUtility(ws));
    });

    test('SPEC: Sign reading higher priority than patrol', () => {
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.unknownSigns', 2);
      ws.set('nearby.reachableTrees', 0);
      ws.set('state.consecutiveIdleTicks', 0);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;

      expect(signGoal.getUtility(ws)).toBeGreaterThan(patrolGoal.getUtility(ws));
    });
  });
});
