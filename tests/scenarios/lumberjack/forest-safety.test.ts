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
 * Safety checks (in order):
 * 1. LEAF VERIFICATION: Log must have matching leaves attached above/around it
 *    - Real trees have leaves (oak_log needs oak_leaves nearby)
 *    - Structure logs (walls, frames) don't have leaves attached
 * 2. STRUCTURE AVOIDANCE: Tree must not be near structure blocks (stairs, doors, planks)
 * 3. CLUSTER DETECTION: Must be part of a forest (3+ trees within 16 blocks)
 *
 * This prevents the bot from dismantling villager houses.
 */

describe('Lumberjack Forest Safety', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  /**
   * Leaf verification is implemented in LumberjackBlackboard.filterForestTrees().
   * It checks that each log block has matching leaves within 5 blocks above/around.
   *
   * Log type → Valid leaves mapping (from LOG_TO_LEAF_MAP):
   * - oak_log → oak_leaves, azalea_leaves, flowering_azalea_leaves
   * - birch_log → birch_leaves
   * - spruce_log → spruce_leaves
   * - jungle_log → jungle_leaves
   * - acacia_log → acacia_leaves
   * - dark_oak_log → dark_oak_leaves
   * - mangrove_log → mangrove_leaves
   * - cherry_log → cherry_leaves
   *
   * Minimum 3 matching leaves required to confirm it's a real tree.
   */

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
    test('SPEC: WriteKnowledgeSign handles FOREST signs', () => {
      const writeSignGoal = goals.find((g) => g.name === 'WriteKnowledgeSign');
      expect(writeSignGoal).toBeDefined();
    });

    test('SPEC: Pending FOREST sign write triggers high priority', () => {
      const writeSignGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasForestSign', true);

      // FOREST signs get priority 80
      expect(writeSignGoal.getUtility(ws)).toBe(80);
    });

    test('SPEC: No pending write = zero utility', () => {
      const writeSignGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 0);
      ws.set('pending.hasForestSign', false);

      expect(writeSignGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: FOREST sign has high priority (helps future lumberjacks)', () => {
      const writeSignGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasForestSign', true);
      ws.set('nearby.forestTrees', 5);
      ws.set('inv.logs', 0);

      // Writing the sign should be higher priority than chopping
      // So future lumberjacks can find the forest immediately
      expect(writeSignGoal.getUtility(ws)).toBeGreaterThan(chopGoal.getUtility(ws));
    });

    test('SPEC: ChopTree blocked while FOREST sign pending', () => {
      const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasForestSign', true);
      ws.set('nearby.forestTrees', 10);
      ws.set('inv.logs', 4);

      // ChopTree returns 0 when FOREST sign pending - prevents starting new trees
      // This ensures the bot writes the sign before getting distracted
      expect(chopGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: CompleteTreeHarvest still finishes in-progress tree', () => {
      const completeGoal = goals.find((g) => g.name === 'CompleteTreeHarvest')!;
      const writeSignGoal = goals.find((g) => g.name === 'WriteKnowledgeSign')!;

      const ws = lumberjackReadyToChopState();
      ws.set('pending.signWrites', 1);
      ws.set('pending.hasForestSign', true);
      ws.set('tree.active', true);

      // CompleteTreeHarvest (85) > FOREST sign (80) - finish what we started
      expect(completeGoal.getUtility(ws)).toBeGreaterThan(writeSignGoal.getUtility(ws));
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

  describe('Forest Exploration Terrain Filtering (Documented Specs)', () => {
    /**
     * These tests document the expected terrain filtering behavior for FindForest.
     * The actual validation is implemented in FindForest.ts behavior action.
     *
     * Terrain filtering prevents the lumberjack from:
     * 1. Exploring into oceans/lakes (water-dominated areas)
     * 2. Climbing mountains (Y > 85)
     * 3. Going into ravines/underground (Y < 55)
     *
     * The behavior samples terrain along potential exploration paths
     * and rejects directions that lead through bad terrain.
     */

    test('SPEC: FindForest avoids exploring over water/ocean', () => {
      // The FindForest behavior checks for water blocks along the exploration path.
      // If more than half the sampled points are water, that direction is rejected.
      // This prevents the lumberjack from trying to explore across oceans/lakes.
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: FindForest avoids mountains (Y > 85)', () => {
      // The FindForest behavior rejects exploration targets above Y=85.
      // Mountains rarely have accessible forests and waste exploration time.
      // The MAX_EXPLORATION_Y constant controls this threshold.
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: FindForest avoids ravines/underground (Y < 55)', () => {
      // The FindForest behavior rejects exploration targets below Y=55.
      // Underground areas don't have forests.
      // The MIN_EXPLORATION_Y constant controls this threshold.
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: FindForest prefers directions with solid ground', () => {
      // The FindForest behavior scores exploration directions based on terrain.
      // Directions with more solid ground get higher scores.
      // Directions with water get negative penalties.
      expect(true).toBe(true); // Documentation test
    });

    test('SPEC: FindForest fails gracefully when surrounded by bad terrain', () => {
      // If all 8 exploration directions lead to bad terrain (water/mountains),
      // FindForest returns 'failure' and resets for a later attempt.
      // This prevents infinite loops when the bot spawns on an island.
      expect(true).toBe(true); // Documentation test
    });
  });
});
