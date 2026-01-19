import { describe, test, expect } from 'bun:test';
import { createLumberjackGoals } from '../../../src/planning/goals/LumberjackGoals';
import {
  freshSpawnLumberjackState,
  lumberjackReadyToChopState,
  lumberjackCanCraftAxeState,
  lumberjackPartialMaterialsState,
} from '../../mocks';

/**
 * SPECIFICATION: Lumberjack Tool Acquisition
 *
 * Lumberjacks need an axe to chop trees efficiently.
 * Priority depends on material availability.
 */

describe('Lumberjack Tools', () => {
  const goals = createLumberjackGoals();

  test('SPEC: Can craft immediately = highest priority (95)', () => {
    const ws = lumberjackCanCraftAxeState();

    const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
    expect(axeGoal.getUtility(ws)).toBe(95);
  });

  test('SPEC: Enough plank equivalent (9+) = high priority (90)', () => {
    const ws = freshSpawnLumberjackState();
    ws.set('has.studiedSigns', true);
    ws.set('inv.logs', 3); // 3 logs = 12 plank equivalent
    ws.set('inv.planks', 0);
    ws.set('derived.canCraftAxe', false);

    const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
    expect(axeGoal.getUtility(ws)).toBe(90);
  });

  test('SPEC: Partial materials = medium priority (75)', () => {
    const ws = lumberjackPartialMaterialsState();
    ws.set('inv.logs', 1);
    ws.set('inv.planks', 2); // 4 + 2 = 6 plank equivalent

    const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
    expect(axeGoal.getUtility(ws)).toBe(75);
  });

  test('SPEC: No materials but trees = low priority (50)', () => {
    const ws = freshSpawnLumberjackState();
    ws.set('has.studiedSigns', true);
    ws.set('nearby.reachableTrees', 5);
    ws.set('inv.logs', 0);
    ws.set('inv.planks', 0);

    const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
    expect(axeGoal.getUtility(ws)).toBe(50);
  });

  test('SPEC: No materials, no trees = zero utility', () => {
    const ws = freshSpawnLumberjackState();
    ws.set('has.studiedSigns', true);
    ws.set('nearby.reachableTrees', 0);
    ws.set('inv.logs', 0);
    ws.set('inv.planks', 0);

    const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
    expect(axeGoal.getUtility(ws)).toBe(0);
  });

  test('SPEC: Already have axe = zero utility', () => {
    const ws = lumberjackReadyToChopState();
    ws.set('has.axe', true);

    const axeGoal = goals.find((g) => g.name === 'ObtainAxe')!;
    expect(axeGoal.getUtility(ws)).toBe(0);
  });
});
