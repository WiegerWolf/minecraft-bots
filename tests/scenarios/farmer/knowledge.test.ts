import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import {
  farmerWithFarmSignPendingState,
  farmerWithMatureCropsState,
  farmerWithUnknownSignsState,
  establishedFarmerState,
} from '../../mocks';

/**
 * SPECIFICATION: Farmer Knowledge Persistence
 *
 * Farmers persist knowledge via signs:
 * - FARM signs are CRITICAL (landscapers need farm locations)
 * - Other signs have moderate priority
 * - Unknown signs should be investigated
 */

describe('Farmer Knowledge', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);

  describe('FARM Sign Writing (Critical)', () => {
    test('SPEC: FARM sign + has sign = CRITICAL priority (250)', () => {
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

    test('SPEC: FARM sign preempts harvesting', () => {
      const ws = farmerWithMatureCropsState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', true);
      ws.set('has.sign', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('WriteKnowledgeSign');
    });
  });

  describe('Other Sign Writing', () => {
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
  });

  describe('Unknown Sign Reading', () => {
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
