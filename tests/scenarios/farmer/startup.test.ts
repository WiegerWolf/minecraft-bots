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

  test('SPEC: After signs, establish farm if village exists (water found = 75)', () => {
    const ws = freshSpawnFarmerState();
    ws.set('has.studiedSigns', true);
    ws.set('nearby.water', 3);
    ws.set('derived.hasVillage', true);  // Village center required

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('EstablishFarm');
    expect(result?.utility).toBe(75);
  });

  test('SPEC: After signs, no village = wait (gather seeds instead)', () => {
    const ws = freshSpawnFarmerState();
    ws.set('has.studiedSigns', true);
    ws.set('nearby.water', 3);
    ws.set('derived.hasVillage', false);  // No village yet

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    // Farmer waits for village - does other tasks like gathering seeds
    expect(result?.goal.name).not.toBe('EstablishFarm');
  });

  test('SPEC: Full startup sequence with village center', () => {
    const ws = freshSpawnFarmerState();

    // Step 1: Study signs
    arbiter.clearCurrentGoal();
    let result = arbiter.selectGoal(ws);
    expect(result?.goal.name).toBe('StudySpawnSigns');

    // Step 2: Wait for village (lumberjack establishes it)
    ws.set('has.studiedSigns', true);
    ws.set('nearby.water', 3);
    ws.set('derived.hasVillage', false);  // No village yet
    result = arbiter.selectGoal(ws);
    expect(result?.goal.name).not.toBe('EstablishFarm');  // Can't establish without village

    // Step 3: Village established - now establish farm
    ws.set('derived.hasVillage', true);
    result = arbiter.selectGoal(ws);
    expect(result?.goal.name).toBe('EstablishFarm');

    // Step 4: With farm, gather seeds if no hoe
    ws.set('derived.hasFarmEstablished', true);
    ws.set('has.hoe', false);
    ws.set('inv.seeds', 0);
    result = arbiter.selectGoal(ws);
    expect(result?.goal.name).toBe('GatherSeeds');
  });
});
