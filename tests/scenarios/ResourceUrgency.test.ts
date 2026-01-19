import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackReadyToChopState,
  farmerWithMatureCropsState,
  farmerReadyToPlantState,
  establishedFarmerState,
  landscaperActiveTerraformState,
  landscaperIdleState,
  landscaperReadyToWorkState,
} from '../mocks';

/**
 * SPECIFICATION: Resource Urgency
 *
 * Dropped items despawn after 5 minutes in Minecraft. This creates urgency:
 * bots must collect nearby drops before they disappear.
 *
 * Key behaviors:
 * - Drops preempt normal work (with some exceptions)
 * - Utility scales with drop count (more drops = more urgent)
 * - Utility capped to prevent over-prioritization
 * - Role-specific differences (landscaper doesn't chase drops during terraform)
 */

describe('Resource Urgency', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // DROPS PREEMPT NORMAL WORK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Drops Preempt Normal Work', () => {
    test('SPEC: Lumberjack drops preempt tree chopping', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 3);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.utility).toBeGreaterThan(100);
    });

    test('SPEC: Farmer drops preempt harvesting', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.drops', 4);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
    });

    test('SPEC: Farmer drops interrupt planting', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = farmerReadyToPlantState();
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');

      // Drops appear
      ws.set('nearby.drops', 3);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');

      // Drops collected - resume
      ws.set('nearby.drops', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');
    });

    test('SPEC: Lumberjack drops interrupt work then resume', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.reachableTrees', 10);

      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');

      // Drops appear
      ws.set('nearby.drops', 4);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('CollectDrops');

      // Drops collected
      ws.set('nearby.drops', 0);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('ChopTree');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY SCALING WITH DROP COUNT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Utility Scaling', () => {
    test('SPEC: Lumberjack more drops = higher urgency', () => {
      const goals = createLumberjackGoals();

      const ws1 = lumberjackReadyToChopState();
      ws1.set('nearby.drops', 1);

      const ws2 = lumberjackReadyToChopState();
      ws2.set('nearby.drops', 5);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;

      expect(collectGoal.getUtility(ws2)).toBeGreaterThan(collectGoal.getUtility(ws1));
    });

    test('SPEC: Farmer drop utility scales with count', () => {
      const goals = createFarmingGoals();
      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;

      const ws1 = establishedFarmerState();
      ws1.set('nearby.drops', 1);

      const ws2 = establishedFarmerState();
      ws2.set('nearby.drops', 5);

      expect(collectGoal.getUtility(ws2)).toBeGreaterThan(collectGoal.getUtility(ws1));
    });

    test('SPEC: Lumberjack drop utility capped at 150', () => {
      const goals = createLumberjackGoals();

      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 5);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBeLessThanOrEqual(150);
    });

    test('SPEC: Farmer drop utility capped at 150', () => {
      const goals = createFarmingGoals();
      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;

      const ws = establishedFarmerState();
      ws.set('nearby.drops', 5);

      expect(collectGoal.getUtility(ws)).toBe(150);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ZERO DROPS = ZERO UTILITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('No Drops = Zero Utility', () => {
    test('SPEC: Lumberjack no drops = zero utility', () => {
      const goals = createLumberjackGoals();
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 0);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Farmer no drops = zero utility', () => {
      const goals = createFarmingGoals();
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 0);

      const collectGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(collectGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Landscaper no drops = zero utility', () => {
      const goals = createLandscaperGoals();
      const ws = landscaperReadyToWorkState();
      ws.set('nearby.drops', 0);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROLE-SPECIFIC DROP BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Role-Specific Drop Behavior', () => {
    test('SPEC: Landscaper drops LOW priority during terraform (utility 40)', () => {
      // Landscaper shouldn't interrupt terraforming to chase drops
      const goals = createLandscaperGoals();
      const ws = landscaperActiveTerraformState();
      ws.set('nearby.drops', 5);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBe(40);
    });

    test('SPEC: Landscaper drops medium priority when idle', () => {
      const goals = createLandscaperGoals();
      const ws = landscaperIdleState();
      ws.set('nearby.drops', 5);
      ws.set('terraform.active', false);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBeGreaterThan(50);
      expect(dropGoal.getUtility(ws)).toBeLessThanOrEqual(80);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITY COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Priority Comparisons', () => {
    test('SPEC: Multiple urgent priorities - highest utility wins', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackReadyToChopState();
      ws.set('nearby.drops', 5); // Utility 150
      ws.set('has.pendingRequests', true); // Utility 120
      ws.set('trade.pendingOffers', 2); // Utility 120

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CollectDrops');
      expect(result?.utility).toBe(150);
    });
  });
});
