import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  freshSpawnLumberjackState,
  lumberjackReadyToChopState,
  freshSpawnFarmerState,
  freshSpawnLandscaperState,
  landscaperIdleState,
  landscaperWithFarmsToCheckState,
} from '../mocks';

/**
 * SPECIFICATION: Startup Behavior
 *
 * When a bot spawns, it must follow a specific boot sequence to orient itself
 * in the world. This sequence ensures the bot:
 * 1. Learns about existing village infrastructure (signs)
 * 2. Checks shared storage for supplies (if known)
 * 3. Transitions to normal work
 *
 * This is critical for multi-bot coordination - bots must learn about
 * existing infrastructure before starting work.
 */

describe('Startup Behavior', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // SIGN STUDY - FIRST PRIORITY FOR ALL ROLES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Sign Study on Spawn', () => {
    const lumberjackGoals = createLumberjackGoals();
    const lumberjackArbiter = new GoalArbiter(lumberjackGoals);

    const farmerGoals = createFarmingGoals();
    const farmerArbiter = new GoalArbiter(farmerGoals);

    const landscaperGoals = createLandscaperGoals();
    const landscaperArbiter = new GoalArbiter(landscaperGoals);

    test('SPEC: Lumberjack studies signs first (utility 200)', () => {
      // Sign study is the highest priority on spawn because the bot
      // needs to learn about existing chests, crafting tables, etc.
      const ws = freshSpawnLumberjackState();

      lumberjackArbiter.clearCurrentGoal();
      const result = lumberjackArbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
      expect(result?.utility).toBe(200);
    });

    test('SPEC: Farmer studies signs first (utility 200)', () => {
      const ws = freshSpawnFarmerState();

      farmerArbiter.clearCurrentGoal();
      const result = farmerArbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
      expect(result?.utility).toBe(200);
    });

    test('SPEC: Landscaper studies signs first (utility 150)', () => {
      // Landscaper has slightly lower priority because it's more reactive
      const ws = freshSpawnLandscaperState();

      landscaperArbiter.clearCurrentGoal();
      const result = landscaperArbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
      expect(result?.utility).toBe(150);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST-SIGN BEHAVIOR - ROLE-SPECIFIC TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Post-Sign Behavior', () => {
    describe('Lumberjack', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);

      test('SPEC: After signs, check storage if available and no axe', () => {
        // Checking storage first is faster than punching trees
        const ws = freshSpawnLumberjackState();
        ws.set('has.studiedSigns', true);
        ws.set('derived.hasStorageAccess', true);
        ws.set('has.checkedStorage', false);
        ws.set('has.axe', false);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('WithdrawSupplies');
        expect(result?.utility).toBe(180);
      });

      test('SPEC: After signs with axe, lower priority storage check', () => {
        const ws = freshSpawnLumberjackState();
        ws.set('has.studiedSigns', true);
        ws.set('derived.hasStorageAccess', true);
        ws.set('has.checkedStorage', false);
        ws.set('has.axe', true);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('WithdrawSupplies');
        expect(result?.utility).toBe(100);
      });

      test('SPEC: After storage checked, proceed to normal work', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('has.checkedStorage', true);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).not.toBe('StudySpawnSigns');
        expect(result?.goal.name).not.toBe('WithdrawSupplies');
      });
    });

    describe('Farmer', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);

      test('SPEC: After signs, establish farm if none exists (water found)', () => {
        const ws = freshSpawnFarmerState();
        ws.set('has.studiedSigns', true);
        ws.set('nearby.water', 3);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('EstablishFarm');
        expect(result?.utility).toBe(75);
      });

      test('SPEC: After signs, establish farm even without water (lower priority)', () => {
        // Bot should explore to find water
        const ws = freshSpawnFarmerState();
        ws.set('has.studiedSigns', true);
        ws.set('nearby.water', 0);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('EstablishFarm');
        expect(result?.utility).toBe(65);
      });
    });

    describe('Landscaper', () => {
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);

      test('SPEC: After signs, check farms if known', () => {
        const ws = landscaperWithFarmsToCheckState();

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('CheckKnownFarms');
      });

      test('SPEC: After signs with no farms, wait (low utility)', () => {
        // Landscaper doesn't explore - it waits for requests
        const ws = landscaperIdleState();
        ws.set('state.farmsNeedingCheck', 0);
        ws.set('inv.dirt', 64);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        // Should have very low or zero utility
        expect(result?.utility ?? 0).toBeLessThan(50);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE STARTUP WORKFLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complete Startup Workflows', () => {
    test('SPEC: Lumberjack full startup sequence', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = freshSpawnLumberjackState();

      // Step 1: Study signs
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: Check storage (if available)
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasStorageAccess', true);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('WithdrawSupplies');

      // Step 3: Normal work
      ws.set('has.checkedStorage', true);
      ws.set('has.axe', false);
      result = arbiter.selectGoal(ws);
      expect(['ObtainAxe', 'PatrolForest'].includes(result?.goal.name ?? '')).toBe(true);
    });

    test('SPEC: Farmer full startup sequence', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = freshSpawnFarmerState();

      // Step 1: Study signs
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: Establish farm
      ws.set('has.studiedSigns', true);
      ws.set('nearby.water', 3);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('EstablishFarm');

      // Step 3: With farm, gather seeds if no hoe
      ws.set('derived.hasFarmEstablished', true);
      ws.set('has.hoe', false);
      ws.set('inv.seeds', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('GatherSeeds');
    });

    test('SPEC: Landscaper full startup sequence', () => {
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = freshSpawnLandscaperState();

      // Step 1: Study signs
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('StudySpawnSigns');

      // Step 2: Get tools if materials available
      ws.set('has.studiedSigns', true);
      ws.set('inv.planks', 10);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ObtainTools');
    });
  });
});
