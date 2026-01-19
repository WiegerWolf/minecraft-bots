import { describe, test, expect } from 'bun:test';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import {
  freshSpawnFarmerState,
  establishedFarmerState,
  farmerNeedingHoeWithMaterialsState,
  farmerNeedingHoeWithChestState,
} from '../../mocks';

/**
 * SPECIFICATION: Farmer Tool Acquisition
 *
 * Farmers need a hoe to till ground. Tool acquisition priority depends on:
 * - Material availability (can craft immediately)
 * - Storage access (can check chest)
 */

describe('Farmer Tools', () => {
  const goals = createFarmingGoals();

  test('SPEC: No hoe + materials = high priority (95)', () => {
    const ws = farmerNeedingHoeWithMaterialsState();
    ws.set('has.studiedSigns', true);

    const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
    expect(toolGoal.getUtility(ws)).toBe(95);
  });

  test('SPEC: No hoe + chest access = medium priority (80)', () => {
    const ws = farmerNeedingHoeWithChestState();
    ws.set('has.studiedSigns', true);

    const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
    expect(toolGoal.getUtility(ws)).toBe(80);
  });

  test('SPEC: No hoe, no materials, no chest = low priority (40)', () => {
    const ws = freshSpawnFarmerState();
    ws.set('has.studiedSigns', true);
    ws.set('has.hoe', false);
    ws.set('inv.logs', 0);
    ws.set('inv.planks', 0);
    ws.set('derived.hasStorageAccess', false);

    const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
    expect(toolGoal.getUtility(ws)).toBe(40);
  });

  test('SPEC: Has hoe = zero utility', () => {
    const ws = establishedFarmerState();
    ws.set('has.hoe', true);

    const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
    expect(toolGoal.getUtility(ws)).toBe(0);
  });
});
