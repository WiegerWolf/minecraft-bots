import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import {
  landscaperWithTerraformRequestState,
  landscaperActiveTerraformState,
  landscaperIdleState,
} from '../../mocks';

/**
 * SPECIFICATION: Landscaper Tool Management
 *
 * Landscapers need BOTH shovel AND pickaxe for terraform work:
 * - Shovel for dirt/grass
 * - Pickaxe for stone/cobblestone
 * - Missing either = degraded capability
 */

describe('Landscaper Tools', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Dual Tool Requirement', () => {
    test('SPEC: Both tools = full terraform capability', () => {
      const ws = landscaperWithTerraformRequestState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(100);
    });

    test('SPEC: Missing pickaxe during terraform = get tools (70)', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('has.pickaxe', false);
      ws.set('inv.planks', 8);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: Missing shovel during terraform = get tools (70)', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('has.shovel', false);
      ws.set('inv.planks', 8);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: Missing both tools = higher urgency', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);
      ws.set('inv.planks', 8);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBeGreaterThanOrEqual(70);
    });
  });

  describe('Tool Acquisition', () => {
    test('SPEC: No materials = cannot obtain tools', () => {
      const ws = landscaperIdleState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', false);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: With planks can craft tools', () => {
      const ws = landscaperIdleState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);
      ws.set('inv.planks', 8);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: With logs can process to planks for tools', () => {
      const ws = landscaperIdleState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);
      ws.set('inv.logs', 4);
      ws.set('inv.planks', 0);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: Has all tools = zero utility for ObtainTools', () => {
      const ws = landscaperIdleState();
      ws.set('has.shovel', true);
      ws.set('has.pickaxe', true);
      ws.set('derived.hasAnyTool', true);

      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;
      expect(toolGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Tool Priority During Work', () => {
    test('SPEC: Tool acquisition > degraded terraform', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('has.pickaxe', false);
      ws.set('inv.planks', 8);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // ObtainTools (70) > FulfillTerraformRequest (50 when missing tool)
      expect(result?.goal.name).toBe('ObtainTools');
    });

    test('SPEC: Full tools = terraform proceeds at full priority', () => {
      const ws = landscaperActiveTerraformState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
      expect(result?.utility).toBe(120);
    });
  });
});
