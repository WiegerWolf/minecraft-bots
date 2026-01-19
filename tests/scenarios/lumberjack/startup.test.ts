import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import { freshSpawnLumberjackState, lumberjackReadyToChopState } from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Startup Behavior
 *
 * When a lumberjack spawns, it must:
 * 1. Study signs to learn about existing infrastructure
 * 2. Check storage for supplies (especially axe)
 * 3. Proceed to normal work
 */

describe('Lumberjack Startup', () => {
  const goals = createLumberjackGoals();
  const arbiter = new GoalArbiter(goals);

  test('SPEC: Fresh spawn studies signs first (utility 200)', () => {
    const ws = freshSpawnLumberjackState();

    arbiter.clearCurrentGoal();
    const result = arbiter.selectGoal(ws);

    expect(result?.goal.name).toBe('StudySpawnSigns');
    expect(result?.utility).toBe(200);
  });

  test('SPEC: After signs, check storage if available and no axe (utility 180)', () => {
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

  test('SPEC: After signs with axe, lower priority storage check (utility 100)', () => {
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

  test('SPEC: Full startup sequence', () => {
    const ws = freshSpawnLumberjackState();

    // Step 1: Study signs
    arbiter.clearCurrentGoal();
    let result = arbiter.selectGoal(ws);
    expect(result?.goal.name).toBe('StudySpawnSigns');

    // Step 2: Check storage
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
});
