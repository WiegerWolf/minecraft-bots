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
    const hasShovel = ws.getBool('has.shovel');
    const hasPickaxe = ws.getBool('has.pickaxe');
    const hasAnyTool = ws.getBool('derived.hasAnyTool');
    const terraformActive = ws.getBool('terraform.active');

    if (!hasPending && !terraformActive) return 0;

    // Continue active terraform - but ONLY if we have BOTH tools
    // Terraforming needs shovel (for dirt/grass) AND pickaxe (for stone)
    if (terraformActive) {
      if (hasShovel && hasPickaxe) {
        return 120; // Have both tools, highest priority
      }
      // Missing a tool - LOW priority so ObtainTools can craft it
      // Must be low enough to overcome hysteresis (20% threshold)
      // ObtainTools returns 70 with materials, so this needs to be < 70/1.2 = 58
      return 50;
    }

    // Can start terraforming - have pending request and both tools
    if (hasShovel && hasPickaxe) return 100;

    // Have at least one tool
    if (hasAnyTool) return 80;

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
 * Goal: Study spawn signs to learn about farm locations.
 * HIGH priority on spawn - done once to discover existing farms.
 *
 * This allows landscapers to proactively check farms for terraform needs
 * instead of only reacting to explicit requests.
 */
export class StudySpawnSignsGoal extends BaseGoal {
  name = 'StudySpawnSigns';
  description = 'Read knowledge signs near spawn';

  conditions = [
    booleanGoalCondition('has.studiedSigns', true, 'has studied signs'),
  ];

  getUtility(ws: WorldState): number {
    const hasStudied = ws.getBool('has.studiedSigns');
    if (hasStudied) return 0;

    // Very high priority on spawn - do this first
    return 150;
  }

  override isValid(ws: WorldState): boolean {
    return !ws.getBool('has.studiedSigns');
  }
}

/**
 * Goal: Check known farms for terraform needs.
 * MODERATE priority when idle - proactive maintenance.
 *
 * After studying signs, the landscaper knows about farms. This goal
 * drives the bot to visit those farms and check if they need terraforming.
 */
export class CheckKnownFarmsGoal extends BaseGoal {
  name = 'CheckKnownFarms';
  description = 'Check known farms for terraform needs';

  conditions = [
    numericGoalCondition('state.farmsNeedingCheck', v => v === 0, 'all farms checked'),
  ];

  getUtility(ws: WorldState): number {
    const farmsNeedingCheck = ws.getNumber('state.farmsNeedingCheck');
    if (farmsNeedingCheck === 0) return 0;

    // Don't check farms if we have pending terraform work
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasPendingRequest) return 0;

    // Don't check farms if we're actively terraforming
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 0;

    // Has tools = higher priority (can actually do the work)
    const hasAnyTool = ws.getBool('derived.hasAnyTool');
    if (hasAnyTool) {
      return 60 + Math.min(farmsNeedingCheck * 10, 30); // 60-90
    }

    // No tools but can still check and queue requests
    return 40 + Math.min(farmsNeedingCheck * 5, 20); // 40-60
  }

  override isValid(ws: WorldState): boolean {
    // Only valid if we've studied signs and have farms to check
    const hasStudied = ws.getBool('has.studiedSigns');
    const farmsNeedingCheck = ws.getNumber('state.farmsNeedingCheck');
    return hasStudied && farmsNeedingCheck > 0;
  }
}

/**
 * Goal: Craft wooden slabs for pathfinding scaffolding.
 * LOW priority - slabs help navigation but aren't critical.
 *
 * Wooden slabs are used by the pathfinder for pillaring and bridging.
 * They're preferred over dirt (needed for terraforming) and cobblestone
 * (hard to break, blocks other bots).
 */
export class CraftSlabsGoal extends BaseGoal {
  name = 'CraftSlabs';
  description = 'Craft wooden slabs for navigation';

  conditions = [
    numericGoalCondition('inv.slabs', v => v >= 16, 'has enough slabs'),
  ];

  getUtility(ws: WorldState): number {
    const slabCount = ws.getNumber('inv.slabs');
    const plankCount = ws.getNumber('inv.planks');

    // Already have enough slabs
    if (slabCount >= 16) return 0;

    // Need planks to craft (3 planks -> 6 slabs)
    if (plankCount < 3) return 0;

    // Don't craft if we're busy with terraform work
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    const terraformActive = ws.getBool('terraform.active');
    if (hasPendingRequest || terraformActive) return 0;

    // Low priority - do this when idle
    // Higher priority when we have more planks (might as well use them)
    const urgency = Math.min(plankCount / 12, 1); // Max at 12 planks
    return 20 + urgency * 15; // Range: 20-35
  }

  override isValid(ws: WorldState): boolean {
    const slabCount = ws.getNumber('inv.slabs');
    const plankCount = ws.getNumber('inv.planks');
    return slabCount < 16 && plankCount >= 3;
  }
}

/**
 * Goal: Gather dirt proactively when idle.
 * LOW-MEDIUM priority - better than idling, ensures readiness.
 *
 * When the landscaper has nothing better to do, gathering dirt prepares
 * them for incoming terraform requests. Having dirt on hand means they
 * can start filling immediately without searching.
 */
export class GatherDirtGoal extends BaseGoal {
  name = 'GatherDirt';
  description = 'Gather dirt to prepare for terraforming';

  conditions = [
    numericGoalCondition('inv.dirt', v => v >= 64, 'has enough dirt'),
  ];

  getUtility(ws: WorldState): number {
    const dirtCount = ws.getNumber('inv.dirt');

    // Already have enough dirt
    if (dirtCount >= 64) return 0;

    // Don't gather if we have pending terraform work
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasPendingRequest) return 0;

    // Don't gather if we're actively terraforming
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 0;

    // Don't gather if we need tools (get tools first)
    const hasShovel = ws.getBool('has.shovel');
    if (!hasShovel) return 0;

    // Don't gather if inventory is full
    const inventoryFull = ws.getBool('state.inventoryFull');
    if (inventoryFull) return 0;

    // Higher priority when we have less dirt
    // Range: 30-50 (below farming checking but above idle)
    const urgency = Math.max(0, (64 - dirtCount) / 64);
    return 30 + urgency * 20;
  }

  override isValid(ws: WorldState): boolean {
    const dirtCount = ws.getNumber('inv.dirt');
    const hasShovel = ws.getBool('has.shovel');
    return dirtCount < 64 && hasShovel;
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
    new StudySpawnSignsGoal(),    // Highest priority on spawn
    new FulfillTerraformRequestGoal(),
    new CheckKnownFarmsGoal(),    // Proactive farm checking
    new ObtainToolsGoal(),
    new DepositItemsGoal(),
    new CollectDropsGoal(),
    new GatherDirtGoal(),         // Proactive dirt gathering when idle
    new CraftSlabsGoal(),         // Craft slabs for navigation scaffolding
    new ExploreGoal(),            // Always last - lowest priority fallback
  ];
}
