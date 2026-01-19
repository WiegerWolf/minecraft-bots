import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import {
  landscaperIdleState,
  landscaperReadyToWorkState,
} from '../../mocks';

/**
 * SPECIFICATION: Landscaper Curiosity Behavior
 *
 * Landscapers should be curious about unknown signs in the wild, just like
 * farmers and lumberjacks. When they see a sign they haven't read, they
 * should investigate it to potentially learn useful information.
 *
 * This is especially useful for landscapers because:
 * - They can discover new farms to check/maintain
 * - They can learn about water sources for terraforming decisions
 * - Signs placed by other bots contain useful coordinate info
 */

describe('Landscaper Curiosity', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Unknown Sign Reading', () => {
    test('SPEC: Landscaper has ReadUnknownSign goal', () => {
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign');
      expect(signGoal).toBeDefined();
    });

    test('SPEC: Unknown signs nearby triggers curiosity', () => {
      const ws = landscaperIdleState();
      ws.set('nearby.unknownSigns', 2);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      expect(signGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: More signs = higher curiosity', () => {
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

      const ws1 = landscaperIdleState();
      ws1.set('nearby.unknownSigns', 1);

      const ws2 = landscaperIdleState();
      ws2.set('nearby.unknownSigns', 3);

      expect(signGoal.getUtility(ws2)).toBeGreaterThan(signGoal.getUtility(ws1));
    });

    test('SPEC: Sign reading lower than terraform work', () => {
      const ws = landscaperReadyToWorkState();
      ws.set('nearby.unknownSigns', 2);
      ws.set('has.pendingTerraformRequest', true);

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

      // Terraform work should take priority over curiosity
      expect(terraformGoal.getUtility(ws)).toBeGreaterThan(signGoal.getUtility(ws));
    });

    test('SPEC: Sign reading higher than idle', () => {
      const ws = landscaperIdleState();
      ws.set('nearby.unknownSigns', 2);
      ws.set('inv.dirt', 64); // Not gathering dirt

      const exploreGoal = goals.find((g) => g.name === 'Explore')!;
      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;

      // Reading signs is more productive than idling
      expect(signGoal.getUtility(ws)).toBeGreaterThan(exploreGoal.getUtility(ws));
    });

    test('SPEC: No unknown signs = zero utility', () => {
      const ws = landscaperIdleState();
      ws.set('nearby.unknownSigns', 0);

      const signGoal = goals.find((g) => g.name === 'ReadUnknownSign')!;
      expect(signGoal.getUtility(ws)).toBe(0);
    });
  });
});
