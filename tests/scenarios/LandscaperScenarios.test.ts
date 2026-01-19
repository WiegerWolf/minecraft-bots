import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { GOAPPlanner } from '../../src/planning/GOAPPlanner';
import { BaseGoal, numericGoalCondition, booleanGoalCondition } from '../../src/planning/Goal';
import { WorldState } from '../../src/planning/WorldState';
import {
  freshSpawnLandscaperState,
  landscaperWithTerraformRequestState,
  createWorldState,
  createLandscaperActionSet,
} from '../mocks';

/**
 * Recreate landscaper goals for testing.
 */
class CollectDropsGoal extends BaseGoal {
  name = 'CollectDrops';
  description = 'Collect dropped items';
  conditions = [numericGoalCondition('nearby.drops', (v) => v === 0, 'no drops')];

  getUtility(ws: WorldState): number {
    const drops = ws.getNumber('nearby.drops');
    if (drops === 0) return 0;
    // Lower priority for landscaper when terraforming
    const terraforming = ws.getBool('terraform.active');
    if (terraforming) return 40;
    return Math.min(80, 50 + drops * 10);
  }
}

class FulfillTerraformRequestGoal extends BaseGoal {
  name = 'FulfillTerraformRequest';
  description = 'Terraform requested area';
  conditions = [booleanGoalCondition('has.pendingTerraformRequest', false, 'no pending terraform')];

  getUtility(ws: WorldState): number {
    if (!ws.getBool('has.pendingTerraformRequest')) return 0;
    // Needs BOTH tools
    const hasShovel = ws.getBool('has.shovel');
    const hasPickaxe = ws.getBool('has.pickaxe');
    if (!hasShovel || !hasPickaxe) return 0;
    return 120;
  }
}

class ObtainToolsGoal extends BaseGoal {
  name = 'ObtainTools';
  description = 'Get shovel and pickaxe';
  conditions = [
    booleanGoalCondition('has.shovel', true, 'has shovel'),
    booleanGoalCondition('has.pickaxe', true, 'has pickaxe'),
  ];

  getUtility(ws: WorldState): number {
    const hasShovel = ws.getBool('has.shovel');
    const hasPickaxe = ws.getBool('has.pickaxe');
    if (hasShovel && hasPickaxe) return 0;
    // High priority if terraform pending
    const hasTerraformRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasTerraformRequest) return 100;
    return 60;
  }
}

class DepositItemsGoal extends BaseGoal {
  name = 'DepositItems';
  description = 'Deposit dirt and stone';
  conditions = [numericGoalCondition('inv.dirt', (v) => v < 10, 'few items')];

  getUtility(ws: WorldState): number {
    const dirt = ws.getNumber('inv.dirt');
    const cobble = ws.getNumber('inv.cobblestone');
    const hasStorage = ws.getBool('derived.hasStorageAccess');
    const inventoryFull = ws.getBool('state.inventoryFull');

    if (!hasStorage) return 0;
    if (inventoryFull) return 85;
    if (dirt >= 64 || cobble >= 64) return 70;
    return 0;
  }
}

class CheckKnownFarmsGoal extends BaseGoal {
  name = 'CheckKnownFarms';
  description = 'Check farms for terraform needs';
  conditions = [numericGoalCondition('state.farmsNeedingCheck', (v) => v === 0, 'all checked')];

  getUtility(ws: WorldState): number {
    const farmsToCheck = ws.getNumber('state.farmsNeedingCheck');
    if (farmsToCheck === 0) return 0;
    return 50;
  }
}

class MaintainFarmsGoal extends BaseGoal {
  name = 'MaintainFarms';
  description = 'Fix issues at farms';
  conditions = [numericGoalCondition('state.farmsWithIssues', (v) => v === 0, 'no issues')];

  getUtility(ws: WorldState): number {
    const farmsWithIssues = ws.getNumber('state.farmsWithIssues');
    if (farmsWithIssues === 0) return 0;
    const hasTools = ws.getBool('derived.hasAnyTool');
    if (!hasTools) return 0;
    return 110;
  }
}

class StudySpawnSignsGoal extends BaseGoal {
  name = 'StudySpawnSigns';
  description = 'Study signs at spawn';
  conditions = [booleanGoalCondition('has.studiedSigns', true, 'studied signs')];

  getUtility(ws: WorldState): number {
    if (ws.getBool('has.studiedSigns')) return 0;
    return 200;
  }
}

class ExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Explore';
  conditions = [numericGoalCondition('state.consecutiveIdleTicks', (v) => v === 0, 'not idle')];

  getUtility(ws: WorldState): number {
    return 5 + Math.min(25, ws.getNumber('state.consecutiveIdleTicks') / 2);
  }
}

function createLandscaperGoals() {
  return [
    new CollectDropsGoal(),
    new FulfillTerraformRequestGoal(),
    new ObtainToolsGoal(),
    new DepositItemsGoal(),
    new CheckKnownFarmsGoal(),
    new MaintainFarmsGoal(),
    new StudySpawnSignsGoal(),
    new ExploreGoal(),
  ];
}

describe('Landscaper Scenarios', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);
  const actions = createLandscaperActionSet();
  const planner = new GOAPPlanner(actions);

  describe('Priority Decisions', () => {
    test('SCENARIO: Fresh spawn - studies signs first', () => {
      const ws = freshSpawnLandscaperState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('StudySpawnSigns');
    });

    test('SCENARIO: Terraform request without tools - gets tools first', () => {
      const ws = freshSpawnLandscaperState();
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.shovel', false);
      ws.set('has.pickaxe', false);
      ws.set('has.studiedSigns', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // ObtainTools (100 when terraform pending) wins
      expect(result?.goal.name).toBe('ObtainTools');
    });

    test('SCENARIO: Terraform request with tools - terraforms', () => {
      const ws = landscaperWithTerraformRequestState();

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('FulfillTerraformRequest');
      expect(result?.utility).toBe(120);
    });

    test('SCENARIO: Farm has issues - maintains before exploring', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.farmsWithIssues', 2);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('MaintainFarms');
      expect(result?.utility).toBe(110);
    });

    test('SCENARIO: Full inventory - deposits before terraforming more', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.inventoryFull', true);
      ws.set('inv.dirt', 64);
      ws.set('derived.hasStorageAccess', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('DepositItems');
    });

    test('SCENARIO: Drops during terraform - lower priority than usual', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('nearby.drops', 3);
      ws.set('terraform.active', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // FulfillTerraformRequest (120) beats CollectDrops (40 during terraform)
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });

    test('SCENARIO: Known farms need checking - checks proactively', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.farmsNeedingCheck', 3);
      ws.set('state.farmsWithIssues', 0);
      ws.set('state.consecutiveIdleTicks', 5);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // CheckKnownFarms (50) beats Explore (~7)
      expect(result?.goal.name).toBe('CheckKnownFarms');
    });
  });

  describe('Tool Requirements', () => {
    test('SCENARIO: Needs both tools - ObtainTools is valid', () => {
      const ws = freshSpawnLandscaperState();
      ws.set('has.shovel', true);
      ws.set('has.pickaxe', false); // Missing one
      ws.set('has.studiedSigns', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('ObtainTools');
    });

    test('SCENARIO: Has both tools - ObtainTools not selected', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.consecutiveIdleTicks', 10);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).not.toBe('ObtainTools');
    });
  });

  describe('Planning Chains', () => {
    test('SCENARIO: Terraform with tools - plans terraforming', () => {
      const ws = createWorldState({
        'has.shovel': true,
        'has.pickaxe': true,
        'has.pendingTerraformRequest': true,
        'has.studiedSigns': true,
      });

      const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
      const planResult = planner.plan(ws, terraformGoal);

      expect(planResult.success).toBe(true);
      expect(planResult.plan[0]?.name).toBe('TerraformArea');
    });

    test('SCENARIO: Need tools - plans crafting', () => {
      const ws = createWorldState({
        'has.shovel': false,
        'has.pickaxe': false,
        'inv.planks': 4,
        'inv.sticks': 4,
        'nearby.craftingTables': 1,
        'has.studiedSigns': true,
      });

      const obtainToolsGoal = goals.find((g) => g.name === 'ObtainTools')!;
      const planResult = planner.plan(ws, obtainToolsGoal);

      expect(planResult.success).toBe(true);
      // Should include crafting both tools
      const actionNames = planResult.plan.map((a) => a.name);
      expect(actionNames).toContain('CraftShovel');
      expect(actionNames).toContain('CraftPickaxe');
    });
  });

  describe('Farm Maintenance Flow', () => {
    test('SCENARIO: No issues known - checks farms first', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.farmsNeedingCheck', 2);
      ws.set('state.farmsWithIssues', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('CheckKnownFarms');
    });

    test('SCENARIO: Issues found - maintains farms', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.farmsNeedingCheck', 0); // Already checked
      ws.set('state.farmsWithIssues', 1);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('MaintainFarms');
    });

    test('SCENARIO: All farms healthy - explores', () => {
      const ws = landscaperWithTerraformRequestState();
      ws.set('has.pendingTerraformRequest', false);
      ws.set('state.farmsNeedingCheck', 0);
      ws.set('state.farmsWithIssues', 0);
      ws.set('state.consecutiveIdleTicks', 10);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('Explore');
    });
  });
});
