import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackNeedsToDepositState,
  lumberjackReadyToChopState,
  establishedFarmerState,
  farmerWithFullInventoryState,
  landscaperFullInventoryState,
  landscaperReadyToWorkState,
  landscaperActiveTerraformState,
} from '../mocks';

/**
 * SPECIFICATION: Inventory Management
 *
 * Bots have limited inventory space. When full, they cannot gather more items.
 * Proper inventory management involves:
 * - Depositing items at thresholds (before completely full)
 * - Higher priority deposits when inventory is full
 * - Role-specific deposit triggers (different item counts)
 * - Requires storage access to deposit
 */

describe('Inventory Management', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // FULL INVENTORY - HIGHEST DEPOSIT PRIORITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Inventory Forces Deposit', () => {
    test('SPEC: Lumberjack full inventory forces deposit (utility 90)', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackNeedsToDepositState();
      ws.set('state.inventoryFull', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositLogs');
      expect(result?.utility).toBe(90);
    });

    test('SPEC: Farmer full inventory forces deposit (utility 90)', () => {
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = farmerWithFullInventoryState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositProduce');
      expect(result?.utility).toBe(90);
    });

    test('SPEC: Landscaper full inventory forces deposit (utility 90)', () => {
      const goals = createLandscaperGoals();
      const ws = landscaperFullInventoryState();

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(90);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LUMBERJACK LOG DEPOSIT THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lumberjack Log Deposit Thresholds', () => {
    const goals = createLumberjackGoals();

    test('SPEC: 32+ logs = high priority (80)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 32);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(80);
    });

    test('SPEC: 16+ logs = medium priority (70)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 16);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: 8+ logs = low priority (60)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 8);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(60);
    });

    test('SPEC: <5 logs = no deposit (utility 0)', () => {
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 4);
      ws.set('state.inventoryFull', false);
      ws.set('has.pendingRequests', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Farmer request increases deposit urgency', () => {
      // If farmer is waiting for wood, deposit whatever we have
      const ws = lumberjackNeedsToDepositState();
      ws.set('inv.logs', 8);
      ws.set('has.pendingRequests', true);
      ws.set('state.inventoryFull', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(85);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FARMER PRODUCE DEPOSIT THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Farmer Produce Deposit Thresholds', () => {
    const goals = createFarmingGoals();

    test('SPEC: 32+ produce = high priority (70)', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 40);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: 16+ produce = medium priority (40)', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 20);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(40);
    });

    test('SPEC: 5+ produce = low priority (20)', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 8);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(20);
    });

    test('SPEC: No produce = zero utility', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 0);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LANDSCAPER ITEM DEPOSIT THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Landscaper Item Deposit Thresholds', () => {
    const goals = createLandscaperGoals();

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
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE ACCESS REQUIREMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Storage Access Requirement', () => {
    test('SPEC: Lumberjack no storage = cannot deposit', () => {
      const goals = createLumberjackGoals();
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 64);
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositLogs')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Farmer no storage = cannot deposit', () => {
      const goals = createFarmingGoals();
      const ws = establishedFarmerState();
      ws.set('inv.produce', 64);
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositProduce')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Landscaper no storage = cannot deposit', () => {
      const goals = createLandscaperGoals();
      const ws = landscaperFullInventoryState();
      ws.set('derived.hasStorageAccess', false);

      const depositGoal = goals.find((g) => g.name === 'DepositItems')!;
      expect(depositGoal.getUtility(ws)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPOSIT VS ACTIVE WORK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deposit vs Active Work', () => {
    test('SPEC: Landscaper full inv during terraform - terraform still wins', () => {
      // If bot has tools, terraform (120) beats deposit (90)
      const goals = createLandscaperGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = landscaperActiveTerraformState();
      ws.set('state.inventoryFull', true);
      ws.set('inv.dirt', 128);
      ws.set('derived.hasStorageAccess', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });

    test('SPEC: Lumberjack normal work vs deposit', () => {
      const goals = createLumberjackGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = lumberjackReadyToChopState();
      ws.set('inv.logs', 32);
      ws.set('derived.hasStorageAccess', true);
      ws.set('nearby.reachableTrees', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Deposit (80) should beat ChopTree (typically 60-70)
      expect(result?.goal.name).toBe('DepositLogs');
    });
  });
});
