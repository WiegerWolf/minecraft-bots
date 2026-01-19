import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import {
  landscaperFullInventoryState,
  landscaperActiveTerraformState,
  landscaperIdleState,
  landscaperReadyToWorkState,
} from '../../mocks';

/**
 * SPECIFICATION: Landscaper Inventory Management
 *
 * Landscapers manage dirt, cobblestone, and other materials:
 * - Drops have LOWER priority during terraform
 * - Deposit at thresholds
 * - Requires storage access
 */

describe('Landscaper Inventory', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Drop Collection', () => {
    test('SPEC: Drops during terraform = LOW priority (40)', () => {
      // Landscaper shouldn't interrupt terraforming for drops
      const ws = landscaperActiveTerraformState();
      ws.set('nearby.drops', 5);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBe(40);
    });

    test('SPEC: Drops when idle = medium priority', () => {
      const ws = landscaperIdleState();
      ws.set('nearby.drops', 5);
      ws.set('terraform.active', false);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBeGreaterThan(50);
      expect(dropGoal.getUtility(ws)).toBeLessThanOrEqual(80);
    });

    test('SPEC: No drops = zero utility', () => {
      const ws = landscaperReadyToWorkState();
      ws.set('nearby.drops', 0);

      const dropGoal = goals.find((g) => g.name === 'CollectDrops')!;
      expect(dropGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Item Deposit', () => {
    test('SPEC: Full inventory forces deposit (utility 90)', () => {
      const ws = landscaperFullInventoryState();

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(90);
    });

    test('SPEC: 128+ items = high priority (80)', () => {
      const ws = landscaperReadyToWorkState();
      ws.set('inv.dirt', 100);
      ws.set('inv.cobblestone', 40);
      ws.set('derived.hasStorageAccess', true);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(80);
    });

    test('SPEC: 64+ items = medium priority (60)', () => {
      const ws = landscaperReadyToWorkState();
      ws.set('inv.dirt', 40);
      ws.set('inv.cobblestone', 30);
      ws.set('derived.hasStorageAccess', true);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(60);
    });

    test('SPEC: <32 items = no deposit (utility 0)', () => {
      const ws = landscaperReadyToWorkState();
      ws.set('inv.dirt', 10);
      ws.set('inv.cobblestone', 5);
      ws.set('derived.hasStorageAccess', true);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No storage = cannot deposit', () => {
      const ws = landscaperFullInventoryState();
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Full inventory during terraform - terraform still wins', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('state.inventoryFull', true);
      ws.set('inv.dirt', 128);
      ws.set('derived.hasStorageAccess', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Terraform (120) > Deposit (90)
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });
  });
});
