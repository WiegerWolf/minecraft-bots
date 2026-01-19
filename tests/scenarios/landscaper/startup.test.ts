import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import {
  freshSpawnLandscaperState,
  landscaperWithFarmsToCheckState,
  landscaperIdleState,
} from '../../mocks';

/**
 * SPECIFICATION: Landscaper Startup Behavior
 *
 * When a landscaper spawns, it must:
 * 1. Study signs to learn about existing farms
 * 2. Check known farms for maintenance
 * 3. Wait for requests (NOT explore)
 */

describe('Landscaper Startup', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  test('SPEC: Fresh spawn studies signs first (utility 150)', () => {
    const ws = freshSpawnLandscaperState();

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('StudySpawnSigns');
    expect(result?.utility).toBe(150);
  });

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

    expect(result?.utility ?? 0).toBeLessThan(50);
  });

  test('SPEC: Full startup sequence', () => {
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
