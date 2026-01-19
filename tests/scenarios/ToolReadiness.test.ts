import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  freshSpawnLumberjackState,
  lumberjackReadyToChopState,
  lumberjackCanCraftAxeState,
  lumberjackPartialMaterialsState,
  freshSpawnFarmerState,
  establishedFarmerState,
  farmerNeedingHoeWithMaterialsState,
  farmerNeedingHoeWithChestState,
  freshSpawnLandscaperState,
  landscaperReadyToWorkState,
  landscaperWithMaterialsState,
  landscaperMissingPickaxeState,
  landscaperActiveTerraformState,
} from '../mocks';

/**
 * SPECIFICATION: Tool Readiness
 *
 * Bots need tools to perform their core work:
 * - Lumberjack needs an axe (chops trees faster)
 * - Farmer needs a hoe (tills ground)
 * - Landscaper needs BOTH shovel AND pickaxe (dig dirt, break stone)
 *
 * Tool acquisition priority depends on:
 * - Material availability (can craft immediately vs need to gather)
 * - Storage access (can check chest for tools/materials)
 * - Current needs (pending work makes tools more urgent)
 */

describe('Tool Readiness', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // LUMBERJACK AXE ACQUISITION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lumberjack Axe', () => {
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

    test('SPEC: No materials but trees nearby = low priority (50)', () => {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FARMER HOE ACQUISITION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Farmer Hoe', () => {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // LANDSCAPER DUAL TOOLS (SHOVEL + PICKAXE)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Landscaper Dual Tools', () => {
    const goals = createLandscaperGoals();

    test('SPEC: Missing BOTH tools + materials = high priority (80)', () => {
      const ws = landscaperWithMaterialsState();

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(80);
    });

    test('SPEC: Missing ONE tool + materials = medium-high priority (70)', () => {
      const ws = landscaperMissingPickaxeState();

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: Missing tool + pending request + storage = high priority (75)', () => {
      const ws = freshSpawnLandscaperState();
      ws.set('has.studiedSigns', true);
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('has.pendingTerraformRequest', true);
      ws.set('derived.hasStorageAccess', true);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(75);
    });

    test('SPEC: Have both tools = zero utility', () => {
      const ws = landscaperReadyToWorkState();

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No materials, no storage = zero utility', () => {
      const ws = freshSpawnLandscaperState();
      ws.set('has.studiedSigns', true);
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', false);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: During terraform, missing tool = ObtainTools wins over terraform', () => {
      // This is critical: landscaper needs BOTH tools to terraform
      const ws = landscaperActiveTerraformState();
      ws.set('has.pickaxe', false);
      ws.set('inv.planks', 8); // Enough materials

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;

      expect(terraformGoal.getUtility(ws)).toBe(50);
      expect(toolGoal.getUtility(ws)).toBe(70);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL ACQUISITION VS OTHER GOALS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tool Priority vs Other Goals', () => {
    test('SPEC: Farmer - no hoe but has farm = gather seeds productively', () => {
      // When waiting for hoe/materials, gathering seeds is productive
      const goals = createFarmingGoals();
      const arbiter = new GoalArbiter(goals);
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('derived.hasFarmEstablished', true);
      ws.set('has.hoe', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', true);
      ws.set('inv.seeds', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should gather seeds or get tools
      expect(['ObtainTools', 'GatherSeeds']).toContain(result?.goal.name);
    });
  });
});
