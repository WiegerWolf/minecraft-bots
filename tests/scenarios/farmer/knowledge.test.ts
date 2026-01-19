import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import { createFarmingActions } from '../../../src/planning/actions/FarmingActions';
import { GOAPPlanner } from '../../../src/planning/GOAPPlanner';
import {
  farmerWithFarmSignPendingState,
  farmerWithMatureCropsState,
  farmerWithUnknownSignsState,
  establishedFarmerState,
  freshSpawnFarmerState,
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

    test('SPEC: FARM sign preempts gathering seeds', () => {
      // Scenario: Farmer just established farm, needs seeds, but FARM sign is pending
      // Expected: FARM sign takes priority even though seeds are needed
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasFarmEstablished', true);
      ws.set('inv.seeds', 0);
      ws.set('nearby.grass', 10);
      // FARM sign pending
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', true);
      ws.set('has.sign', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('WriteKnowledgeSign');
    });

    test('SPEC: FARM sign preempts obtaining hoe when hoe already obtained', () => {
      // Scenario: Farmer has hoe but FARM sign is pending
      // Expected: FARM sign takes priority over any tool-related goals
      const ws = establishedFarmerState();
      ws.set('has.hoe', true);
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', true);
      ws.set('derived.canCraftSign', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('WriteKnowledgeSign');
    });

    test('SPEC: FARM sign without materials still has very high priority', () => {
      // This is the KEY test - FARM sign should be prioritized even without materials
      // The farmer should get materials SPECIFICALLY for the sign
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasFarmEstablished', true);
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', true);
      ws.set('has.sign', false);
      ws.set('derived.canCraftSign', false);
      ws.set('inv.planks', 0);
      ws.set('inv.sticks', 0);
      ws.set('derived.hasStorageAccess', true); // Has chest access
      ws.set('nearby.chests', 1);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;

      // Should still have high utility even without materials
      // The bot should prioritize getting materials for the sign
      expect(signGoal.getUtility(ws)).toBeGreaterThanOrEqual(200);
    });
  });

  describe('FARM Sign Planning (GOAP)', () => {
    const actions = createFarmingActions();
    const planner = new GOAPPlanner(actions);

    test('SPEC: Planner finds plan for FARM sign when materials in chest', () => {
      // Scenario: FARM sign pending, no sign/materials, but has chest access
      // Expected: Planner should chain GetSignMaterials → WriteKnowledgeSign
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasFarmEstablished', true);
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasFarmSign', true);
      ws.set('has.sign', false);
      ws.set('derived.canCraftSign', false);
      ws.set('inv.planks', 0);
      ws.set('inv.sticks', 0);
      ws.set('derived.hasStorageAccess', true);
      ws.set('nearby.chests', 1);
      // Need to indicate we need sign materials
      ws.set('needs.signMaterials', true);

      const signGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      const result = planner.plan(ws, signGoal);

      // Should find SOME plan to write the sign
      // If success is false, planner couldn't find a plan - this is what we want to fix!
      expect(result.success).toBe(true);
      expect(result.plan.length).toBeGreaterThan(0);
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
