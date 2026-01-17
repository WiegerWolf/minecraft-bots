import { BaseGoal, numericGoalCondition, booleanGoalCondition } from '../Goal';
import { WorldState } from '../WorldState';

/**
 * Goal: Collect dropped items before they despawn.
 * For landscaper: LOW priority - don't chase drops, focus on terraforming.
 * Only pick up items that are very close (likely from own work).
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

    // Don't interrupt active terraforming for drops
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 40; // Low priority when terraforming

    // Lower utility than FulfillTerraformRequest - landscaper shouldn't chase drops
    return Math.min(80, 50 + dropCount * 5);
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
    booleanGoalCondition('terraform.active', false, 'no active terraform task'),
  ];

  getUtility(ws: WorldState): number {
    const hasPending = ws.getBool('has.pendingTerraformRequest');
    const hasTools = ws.getBool('derived.hasAnyTool');
    const terraformActive = ws.getBool('terraform.active');

    if (!hasPending && !terraformActive) return 0;

    // Continue active terraform - HIGHEST priority for landscaper
    if (terraformActive) return 120;

    // Can start terraforming - have pending request and tools
    if (hasTools) return 100;

    // Have pending request but no tools - still important
    return 50;
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
    const hasStorageAccess = ws.getBool('derived.hasStorageAccess');
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');

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

    // No materials but have chest access - can go get materials!
    // This is especially important when we have a pending terraform request
    if (hasStorageAccess) {
      if (hasPendingRequest) {
        return 75; // High priority - need tools to fulfill request
      }
      return 40; // Moderate priority - check chest for materials
    }

    // No materials and no chest access - can't do anything
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
 * Goal: Wait at spawn for terraform requests.
 * The landscaper should idle until called by other bots or until
 * materials are available in the shared chest.
 *
 * Returns 0 utility - landscaper just waits rather than exploring.
 */
export class ExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Wait at spawn for terraform requests';

  conditions = [
    numericGoalCondition('state.consecutiveIdleTicks', v => v === 0, 'not idle', {
      value: 0,
      comparison: 'eq',
      estimatedDelta: -1,
    }),
  ];

  getUtility(ws: WorldState): number {
    // Landscaper should just wait at spawn - don't explore
    // It will become active when:
    // 1. FulfillTerraformRequest goal activates (pending request)
    // 2. ObtainTools goal activates (materials in chest)
    return 0;
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
