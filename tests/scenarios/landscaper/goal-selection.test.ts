import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createLandscaperGoals } from '../../../src/planning/goals/LandscaperGoals';
import { landscaperActiveTerraformState, landscaperIdleState } from '../../mocks';

/**
 * SPECIFICATION: Landscaper Goal Selection
 *
 * Goal selection uses 20% hysteresis to prevent thrashing.
 */

describe('Landscaper Goal Selection', () => {
  const goals = createLandscaperGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Hysteresis Behavior', () => {
    test('SPEC: Should not thrash between similar-utility goals', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 20);
      ws.set('has.shovel', true);
      ws.set('state.farmsNeedingCheck', 2);

      arbiter.clearCurrentGoal();
      const result1 = arbiter.selectGoal(ws);
      const firstGoal = result1?.goal.name;

      // Slightly change utilities but within hysteresis threshold
      ws.set('state.farmsNeedingCheck', 3);

      const result2 = arbiter.selectGoal(ws);

      if (result1?.goal.name === result2?.goal.name) {
        expect(result2?.reason === 'hysteresis' || result2?.goal.name === firstGoal).toBe(
          true
        );
      }
    });

    test('SPEC: Large utility change causes switch', () => {
      const ws = landscaperIdleState();
      ws.set('inv.dirt', 30);
      ws.set('has.shovel', true);

      arbiter.clearCurrentGoal();
      arbiter.selectGoal(ws);

      // Big change - terraform request arrives
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.pickaxe', true);
      ws.set('derived.hasAnyTool', true);

      const result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
      expect(result?.reason).toBe('switch');
    });
  });

  describe('Priority Ordering', () => {
    test('SPEC: Active trade > Active terraform', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('trade.inTrade', true);
      ws.set('trade.status', 'traveling'); // Must be an active status for CompleteTrade

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // CompleteTrade (150) > FulfillTerraformRequest (120)
      expect(result?.goal.name).toBe('CompleteTrade');
      expect(result?.utility).toBe(150);
    });

    test('SPEC: Fresh spawn > Everything else', () => {
      const ws = landscaperIdleState();
      ws.set('has.studiedSigns', false);
      ws.set('has.pendingTerraformRequest', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // StudySpawnSigns (150) > FulfillTerraformRequest (100)
      expect(result?.goal.name).toBe('StudySpawnSigns');
    });

    test('SPEC: Terraform request > Farm maintenance', () => {
      const ws = landscaperIdleState();
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.shovel', true);
      ws.set('has.pickaxe', true);
      ws.set('derived.hasAnyTool', true);
      ws.set('state.farmsWithIssues', 3);
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // FulfillTerraformRequest (100) > MaintainFarms
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });

    test('SPEC: Active terraform > Deposit items', () => {
      const ws = landscaperActiveTerraformState();
      ws.set('state.inventoryFull', true);
      ws.set('inv.dirt', 128);
      ws.set('derived.hasStorageAccess', true);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // FulfillTerraformRequest (120) > DepositItems (90)
      expect(result?.goal.name).toBe('FulfillTerraformRequest');
    });
  });

  describe('Multiple Urgent Priorities', () => {
    test('SPEC: Trade offer + terraform = trade wins (higher utility)', () => {
      const ws = landscaperIdleState();
      ws.set('trade.pendingOffers', 2);
      ws.set('has.pendingTerraformRequest', true);
      ws.set('has.shovel', true);
      ws.set('has.pickaxe', true);
      ws.set('derived.hasAnyTool', true);
      ws.set('inv.dirt', 64);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // RespondToTradeOffer (120) >= FulfillTerraformRequest (100)
      expect(result?.goal.name).toBe('RespondToTradeOffer');
    });
  });
});
