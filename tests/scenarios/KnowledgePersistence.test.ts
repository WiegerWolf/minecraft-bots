import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import {
  lumberjackWithPendingSignsState,
  lumberjackReadyToChopState,
  lumberjackWithUnknownSignsState,
  farmerWithFarmSignPendingState,
  farmerWithMatureCropsState,
  farmerWithUnknownSignsState,
  establishedFarmerState,
} from '../mocks';

/**
 * SPECIFICATION: Knowledge Persistence
 *
 * Bots persist knowledge using Minecraft signs placed near spawn. This enables:
 * - New bots to learn about existing infrastructure
 * - Bots to communicate without direct messages
 * - Survival of knowledge across bot restarts
 *
 * Key behaviors:
 * - Reading signs on spawn (StudySpawnSigns)
 * - Writing signs after placing infrastructure
 * - Investigating unknown signs
 * - FARM signs have CRITICAL priority (landscapers need them)
 */

describe('Knowledge Persistence', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN WRITING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Sign Writing', () => {
    describe('Lumberjack', () => {
      const goals = createLumberjackGoals();

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

    describe('Farmer - FARM Signs are Critical', () => {
      const goals = createFarmingGoals();

      test('SPEC: FARM sign + has sign = CRITICAL priority (250)', () => {
        // FARM signs are critical because landscapers need farm locations
        const ws = farmerWithFarmSignPendingState();
        ws.set('has.sign', true);

        const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
        expect(signGoal.getUtility(ws)).toBe(250);
      });

      test('SPEC: FARM sign + can craft = very high priority (230)', () => {
        const ws = farmerWithFarmSignPendingState();
        ws.set('has.sign', false);
        ws.set('derived.canCraftSign', true);

        const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
        expect(signGoal.getUtility(ws)).toBe(230);
      });

      test('SPEC: FARM sign + storage access = high priority (210)', () => {
        const ws = farmerWithFarmSignPendingState();
        ws.set('has.sign', false);
        ws.set('derived.canCraftSign', false);

        const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
        expect(signGoal.getUtility(ws)).toBe(210);
      });

      test('SPEC: Other sign types = moderate priority (120)', () => {
        const ws = establishedFarmerState();
        ws.set('pending.signWrites', 1);
        ws.set('pending.hasFarmSign', false);
        ws.set('has.sign', true);

        const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
        expect(signGoal.getUtility(ws)).toBe(120);
      });

      test('SPEC: No pending signs = zero utility', () => {
        const ws = establishedFarmerState();
        ws.set('pending.signWrites', 0);

        const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
        expect(signGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: FARM sign preempts harvesting', () => {
        const arbiter = new GoalArbiter(goals);
        const ws = farmerWithMatureCropsState();
        ws.set('pending.signWrites', 1);
        ws.set('pending.hasFarmSign', true);
        ws.set('has.sign', true);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('WriteKnowledgeSign');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN READING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Unknown Sign Reading', () => {
    describe('Lumberjack', () => {
      const goals = createLumberjackGoals();

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

    describe('Farmer', () => {
      const goals = createFarmingGoals();

      test('SPEC: Should investigate unknown signs', () => {
        const ws = farmerWithUnknownSignsState();

        const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
        expect(signGoal.getUtility(ws)).toBeGreaterThan(45);
      });

      test('SPEC: More signs = slightly higher priority', () => {
        const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

        const ws1 = farmerWithUnknownSignsState();
        ws1.set('nearby.unknownSigns', 1);

        const ws2 = farmerWithUnknownSignsState();
        ws2.set('nearby.unknownSigns', 3);

        expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
      });

      test('SPEC: Sign reading lower than core farming', () => {
        const ws = farmerWithMatureCropsState();
        ws.set('nearby.unknownSigns', 2);

        const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;
        const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

        expect(harvestGoal.getUtility(ws)).toBeGreaterThan(signGoal.getUtility(ws));
      });
    });
  });
});
