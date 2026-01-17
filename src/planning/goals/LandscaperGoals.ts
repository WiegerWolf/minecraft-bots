import { BaseGoal, numericGoalCondition, booleanGoalCondition } from '../Goal';
import { WorldState } from '../WorldState';

/**
 * Goal: Collect dropped items before they despawn.
 * HIGHEST PRIORITY - items despawn after 5 minutes.
 */
export class CollectDropsGoal extends BaseGoal {
  name = 'CollectDrops';
  description = 'Collect dropped items before they despawn';

  conditions = [
    numericGoalCondition('nearby.drops', v => v === 0, 'no drops nearby'),
  ];

  getUtility(ws: WorldState): number {
    const dropCount = ws.getNumber('nearby.drops');
    if (dropCount === 0) return 0;

    // Very high base utility + scale with count
    return Math.min(150, 100 + dropCount * 10);
  }
}

/**
 * Goal: Fulfill a pending terraform request.
 * HIGH priority when request is pending and we have tools.
 */
export class FulfillTerraformRequestGoal extends BaseGoal {
  name = 'FulfillTerraformRequest';
  description = 'Complete a pending terraform request';

  conditions = [
    booleanGoalCondition('has.pendingTerraformRequest', false, 'no pending terraform'),
  ];

  getUtility(ws: WorldState): number {
    const hasPending = ws.getBool('has.pendingTerraformRequest');
    const hasTools = ws.getBool('derived.hasAnyTool');
    const terraformActive = ws.getBool('terraform.active');

    if (!hasPending && !terraformActive) return 0;

    // Continue active terraform
    if (terraformActive) return 95;

    // Can start terraforming - have pending request and tools
    if (hasTools) return 85;

    // Have pending request but no tools - still important
    return 30;
  }
}

/**
 * Goal: Obtain tools (shovel and/or pickaxe).
 * HIGH priority when we have materials and need tools.
 */
export class ObtainToolsGoal extends BaseGoal {
  name = 'ObtainTools';
  description = 'Craft shovel and pickaxe';

  conditions = [
    booleanGoalCondition('has.shovel', true, 'has shovel'),
    booleanGoalCondition('has.pickaxe', true, 'has pickaxe'),
  ];

  getUtility(ws: WorldState): number {
    const hasShovel = ws.getBool('has.shovel');
    const hasPickaxe = ws.getBool('has.pickaxe');

    // Already have both tools
    if (hasShovel && hasPickaxe) return 0;

    const logCount = ws.getNumber('inv.logs');
    const plankCount = ws.getNumber('inv.planks');
    const plankEquivalent = plankCount + (logCount * 4);

    // Have materials to craft tools
    if (plankEquivalent >= 7) {
      // Missing both tools - high priority
      if (!hasShovel && !hasPickaxe) return 80;
      // Missing one tool
      return 70;
    }

    // Have some materials
    if (plankEquivalent >= 3) {
      return 50;
    }

    // No materials - can't craft
    return 0;
  }
}

/**
 * Goal: Deposit items when inventory is getting full.
 */
export class DepositItemsGoal extends BaseGoal {
  name = 'DepositItems';
  description = 'Deposit dirt and cobblestone to chest';

  conditions = [
    numericGoalCondition('inv.dirt', v => v < 10, 'inventory cleared', {
      value: 10,
      comparison: 'lte',
      estimatedDelta: -64,
    }),
  ];

  getUtility(ws: WorldState): number {
    const dirtCount = ws.getNumber('inv.dirt');
    const cobbleCount = ws.getNumber('inv.cobblestone');
    const inventoryFull = ws.getBool('state.inventoryFull');
    const hasStorage = ws.getBool('derived.hasStorageAccess');

    if (!hasStorage) return 0;
    if (dirtCount === 0 && cobbleCount === 0) return 0;

    // Very high priority when inventory full
    if (inventoryFull) return 90;

    // High priority when we have lots of items
    const totalItems = dirtCount + cobbleCount;
    if (totalItems >= 128) return 80;
    if (totalItems >= 64) return 60;
    if (totalItems >= 32) return 40;
    return 0;
  }
}

/**
 * Goal: Explore and wait for terraform requests.
 * LOWEST priority - fallback when nothing else to do.
 */
export class ExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Explore and wait for terraform requests';

  conditions = [
    numericGoalCondition('state.consecutiveIdleTicks', v => v === 0, 'not idle', {
      value: 0,
      comparison: 'eq',
      estimatedDelta: -1,
    }),
  ];

  getUtility(ws: WorldState): number {
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    const idleTicks = ws.getNumber('state.consecutiveIdleTicks');

    // If we have a pending request, don't explore
    if (hasPendingRequest) return 5;

    // Increase utility when idle for too long
    if (idleTicks > 10) {
      return 15 + Math.min(25, idleTicks / 2);
    }

    // Low base utility - exploration is a fallback
    return 10;
  }

  override isValid(ws: WorldState): boolean {
    return true; // Always valid as fallback
  }
}

/**
 * Registry of all landscaper goals.
 */
export function createLandscaperGoals(): BaseGoal[] {
  return [
    new CollectDropsGoal(),
    new FulfillTerraformRequestGoal(),
    new ObtainToolsGoal(),
    new DepositItemsGoal(),
    new ExploreGoal(), // Always last - lowest priority fallback
  ];
}
