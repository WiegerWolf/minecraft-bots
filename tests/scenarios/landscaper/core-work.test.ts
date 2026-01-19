import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import {
  landscaperWithTerraformRequestState,
  landscaperActiveTerraformState,
  landscaperIdleState,
  landscaperWithFarmsToCheckState,
  landscaperWithFarmMaintenanceState,
} from '../../mocks';

/**
 * SPECIFICATION: Landscaper Core Work
 *
 * The landscaper's primary responsibilities:
 * - Fulfill terraform requests (flattening terrain)
 * - Check known farms for maintenance needs
 * - Maintain farms (fix holes, water issues)
 * - Gather dirt proactively
 * - Craft slabs for navigation
 */

describe('Landscaper Core Work', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Terraform Fulfillment', () => {
    test('SPEC: Pending request + both tools = high priority (100)', () => {
      const ws = landscaperWithTerraformRequestState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(100);
    });

    test('SPEC: Active terraform + both tools = highest priority (120)', () => {
      const ws = landscaperActiveTerraformState();

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(120);
    });

    test('SPEC: Missing tool during terraform = low priority (let ObtainTools win)', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('has.pickaxe', false);
      ws.set('inv.planks', 8);

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      const toolGoal = goals.find((g) => g.name === 'ObtainTools')!;

      expect(terraformGoal.getUtility(ws)).toBe(50);
      expect(toolGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: No tools + no materials = cannot fulfill', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 0);
      ws.set('derived.hasStorageAccess', false);

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No pending request = zero utility', () => {
      const ws = landscaperIdleState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('terraform.active', false);

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      expect(terraformGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Request triggers immediate work', () => {
      const ws = landscaperWithTerraformRequestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });
  });

  describe('Farm Checking', () => {
    test('SPEC: Farms needing check + tools = high priority', () => {
      const ws = landscaperWithFarmsToCheckState();

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBeGreaterThan(60);
    });

    test('SPEC: Farms needing check + no tools = moderate priority', () => {
      const ws = landscaperWithFarmsToCheckState();
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('derived.hasAnyTool', false);

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBeGreaterThan(40);
    });

    test('SPEC: Don\'t check farms during active terraform', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('state.farmsNeedingCheck', 3);

      const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
      expect(checkGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Farm Maintenance', () => {
    test('SPEC: Farms with issues = high maintenance priority', () => {
      const ws = landscaperWithFarmMaintenanceState();

      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
      expect(maintainGoal.getUtility(ws)).toBeGreaterThan(80);
    });

    test('SPEC: More farms with issues = higher priority', () => {
      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;

      const ws1 = landscaperWithFarmMaintenanceState();
      ws1.set('state.farmsWithIssues', 1);

      const ws2 = landscaperWithFarmMaintenanceState();
      ws2.set('state.farmsWithIssues', 3);

      expect(maintainGoal.getUtility(ws2)).toBeGreaterThan(maintainGoal.getUtility(ws1));
    });

    test('SPEC: No dirt = cannot maintain', () => {
      const ws = landscaperWithFarmMaintenanceState();
      ws.set('inv.dirt', 0);

      const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
      expect(maintainGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Proactive maintenance workflow', () => {
      const ws = landscaperWithFarmMaintenanceState();
      ws.set('has.pendingTerraformRequest', false);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('MaintainFarms');
    });
  });

  describe('Dirt Gathering', () => {
    test('SPEC: Low dirt when idle = gather', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 16);
      ws.set('has.shovel', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBeGreaterThan(30);
    });

    test('SPEC: Less dirt = higher priority', () => {
      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;

      const ws1 = landscaperIdleState();
      ws1.set('inv.dirt', 50);
      ws1.set('has.shovel', true);

      const ws2 = landscaperIdleState();
      ws2.set('inv.dirt', 10);
      ws2.set('has.shovel', true);

      expect(gatherGoal.getUtility(ws2)).toBeGreaterThan(gatherGoal.getUtility(ws1));
    });

    test('SPEC: Enough dirt = zero utility', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 64);
      ws.set('has.shovel', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Don\'t gather during terraform', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 10);
      ws.set('terraform.active', true);
      ws.set('has.shovel', true);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No shovel = cannot gather', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 10);
      ws.set('has.shovel', false);

      const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
      expect(gatherGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Slab Crafting', () => {
    test('SPEC: Low slabs + planks = craft when idle', () => {
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 12);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBeGreaterThan(20);
    });

    test('SPEC: Enough slabs = zero utility', () => {
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 20);
      ws.set('inv.planks', 12);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No planks = cannot craft', () => {
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 1);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Don\'t craft during terraform', () => {
      const ws = landscaperIdleState();
      ws.set('inv.slabs', 4);
      ws.set('inv.planks', 12);
      ws.set('terraform.active', true);

      const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
      expect(slabGoal.getUtility(ws)).toBe(0);
    });
  });
});
