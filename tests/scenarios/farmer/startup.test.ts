import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import { freshSpawnFarmerState } from '../../mocks';

/**
 * SPECIFICATION: Farmer Startup Behavior
 *
 * When a farmer spawns, it must:
 * 1. Study signs to learn about existing infrastructure
 * 2. Establish a farm near water (if none exists)
 * 3. Gather seeds or get tools to begin farming
 */

describe('Farmer Startup', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);

  test('SPEC: Fresh spawn studies signs first (utility 200)', () => {
    const ws = freshSpawnFarmerState();

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('StudySpawnSigns');
    expect(result?.utility).toBe(200);
  });

  test('SPEC: After signs, establish farm if none exists (water found = 75)', () => {
    const ws = freshSpawnFarmerState();
    ws.set('has.studiedSigns', true);
    ws.set('nearby.water', 3);

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('EstablishFarm');
    expect(result?.utility).toBe(75);
  });

  test('SPEC: After signs, establish farm even without water (utility 65)', () => {
    const ws = freshSpawnFarmerState();
    ws.set('has.studiedSigns', true);
    ws.set('nearby.water', 0);

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('EstablishFarm');
    expect(result?.utility).toBe(65);
  });

  test('SPEC: Full startup sequence', () => {
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
});
