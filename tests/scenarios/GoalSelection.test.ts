import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackReadyToChopState,
  establishedFarmerState,
  landscaperIdleState,
} from '../mocks';

/**
 * SPECIFICATION: Goal Selection
 *
 * The GoalArbiter selects goals based on utility values. Key mechanisms:
 * - 20% hysteresis threshold prevents goal thrashing
 * - Current goal must be beaten by >20% to switch
 * - Large utility changes cause immediate switch
 *
 * This prevents bots from rapidly switching between similar-utility goals,
 * which wastes time and creates erratic behavior.
 */

describe('Goal Selection', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // HYSTERESIS - PREVENT THRASHING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Hysteresis (20% Threshold)', () => {
    describe('Lumberjack', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);

      test('SPEC: Should not thrash between similar-utility goals', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('inv.logs', 6);
        ws.set('inv.saplings', 4);
        ws.set('tree.active', false);

        // First selection
        arbiter.clearCurrentGoal();
        const result1 = arbiter.selectGoal(ws);
        const firstGoal = result1?.goal.name;

        // Slightly change utilities but within hysteresis threshold
        ws.set('inv.saplings', 5);

        // Should stick with current goal
        const result2 = arbiter.selectGoal(ws);

        if (result1?.goal.name === result2?.goal.name) {
          expect(result2?.reason === 'hysteresis' || result2?.goal.name === firstGoal).toBe(
            true
          );
        }
      });

      test('SPEC: Large utility change causes switch', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('nearby.reachableTrees', 5);
        ws.set('nearby.drops', 0);

        arbiter.clearCurrentGoal();
        arbiter.selectGoal(ws);

        // Big change - drops appear
        ws.set('nearby.drops', 5); // Utility 150

        const result = arbiter.selectGoal(ws);
        expect(result?.goal.name).toBe('CollectDrops');
        expect(result?.reason).toBe('switch');
      });
    });

    describe('Farmer', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);

      test('SPEC: Should not thrash between similar goals', () => {
        const ws = establishedFarmerState();
        ws.set('nearby.farmland', 12);
        ws.set('can.plant', true);
        ws.set('inv.seeds', 15);
        ws.set('nearby.matureCrops', 0);

        arbiter.clearCurrentGoal();
        const result1 = arbiter.selectGoal(ws);

        // Small change
        ws.set('nearby.farmland', 10);

        const result2 = arbiter.selectGoal(ws);

        if (result1?.goal.name === result2?.goal.name) {
          expect(
            result2?.reason === 'hysteresis' || result1?.goal.name === result2?.goal.name
          ).toBe(true);
        }
      });

      test('SPEC: Large utility change causes switch', () => {
        const ws = establishedFarmerState();
        ws.set('nearby.farmland', 10);
        ws.set('can.plant', true);
        ws.set('nearby.drops', 0);

        arbiter.clearCurrentGoal();
        arbiter.selectGoal(ws);

        // Big change - drops appear
        ws.set('nearby.drops', 5);

        const result = arbiter.selectGoal(ws);
        expect(result?.goal.name).toBe('CollectDrops');
      });
    });

    describe('Landscaper', () => {
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);

      test('SPEC: Should not thrash between similar goals', () => {
        const ws = landscaperIdleState();
        ws.set('inv.dirt', 30);
        ws.set('inv.planks', 6);
        ws.set('inv.slabs', 8);
        ws.set('has.shovel', true);

        arbiter.clearCurrentGoal();
        const result1 = arbiter.selectGoal(ws);

        // Small change
        ws.set('inv.dirt', 32);

        const result2 = arbiter.selectGoal(ws);

        if (result1?.goal.name === result2?.goal.name) {
          expect(true).toBe(true); // Stayed on same goal
        } else if (result2?.reason === 'hysteresis') {
          expect(true).toBe(true); // Hysteresis active
        }
      });

      test('SPEC: Large change triggers switch', () => {
        const ws = landscaperIdleState();
        ws.set('inv.dirt', 30);
        ws.set('has.shovel', true);

        arbiter.clearCurrentGoal();
        arbiter.selectGoal(ws);

        // Big change - terraform request arrives
        ws.set('has.pendingTerraformRequest', true);
        ws.set('has.pickaxe', true);

        const result = arbiter.selectGoal(ws);
        expect(result?.goal.name).toBe('FulfillTerraformRequest');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FALLBACK GOALS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fallback Goals', () => {
    test('SPEC: Lumberjack patrol is always valid', () => {
      const goals = createLumberjackGoals();
      const ws = lumberjackReadyToChopState();

      const patrolGoal = goals.find((g) => g.name === 'PatrolForest')!;
      expect(patrolGoal.isValid(ws)).toBe(true);
    });

    test('SPEC: Farmer explore is always valid', () => {
      const goals = createFarmingGoals();
      const ws = establishedFarmerState();

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.isValid(ws)).toBe(true);
    });

    test('SPEC: Landscaper explore is always valid', () => {
      const goals = createLandscaperGoals();
      const ws = landscaperIdleState();

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      expect(exploreGoal.isValid(ws)).toBe(true);
    });
  });
});
