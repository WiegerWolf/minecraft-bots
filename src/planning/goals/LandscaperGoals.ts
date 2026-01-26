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

    // Check if we can get tools if we're missing them
    // Need materials OR storage access to craft tools
    const logCount = ws.getNumber('inv.logs');
    const plankCount = ws.getNumber('inv.planks');
    const plankEquivalent = plankCount + (logCount * 4);
    const hasStorageAccess = ws.getBool('derived.hasStorageAccess');
    const canObtainTools = plankEquivalent >= 3 || hasStorageAccess;

    // Continue active terraform - but ONLY if we have BOTH tools
    // Terraforming needs shovel (for dirt/grass) AND pickaxe (for stone)
    if (terraformActive) {
      if (hasShovel && hasPickaxe) {
        return 120; // Have both tools, highest priority
      }
      // Missing a tool - can we get one?
      if (!canObtainTools) {
        // Can't get tools - return 0 to avoid stuck loop
        // This goal will become plannable once tools become available
        return 0;
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

    // Have pending request but no tools
    if (!canObtainTools) {
      // Can't get tools - return 0 to avoid stuck loop
      return 0;
    }
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
 * Goal: Actively maintain known farms - fix holes, stacked water, etc.
 * MEDIUM-HIGH priority - farms need regular upkeep.
 *
 * The landscaper periodically visits known farms to:
 * 1. Fix stacked water (water below the central water source)
 * 2. Seal spreading water
 * 3. Fill holes in the farm surface
 *
 * Farm structure should be:
 * - Top layer: 9x9 dirt with single water source in center
 * - Bottom layer: solid blocks (NO water)
 */
export class MaintainFarmsGoal extends BaseGoal {
  name = 'MaintainFarms';
  description = 'Actively maintain and repair known farms';

  // Goal is satisfied when all farms with issues are repaired
  // (issue-based, not time-based)
  conditions = [
    booleanGoalCondition('state.farmMaintenanceNeeded', false, 'farms maintained'),
  ];

  getUtility(ws: WorldState): number {
    const farmsWithIssues = ws.getNumber('state.farmsWithIssues');
    const hasStudied = ws.getBool('has.studiedSigns');
    const maintenanceNeeded = ws.getBool('state.farmMaintenanceNeeded');

    // No farms with actual issues detected
    if (!maintenanceNeeded || farmsWithIssues === 0) return 0;

    // Haven't studied signs yet
    if (!hasStudied) return 0;

    // Don't maintain if we have pending terraform work (do that first)
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasPendingRequest) return 0;

    // Don't maintain if actively terraforming
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 0;

    // Need dirt to fix issues (but can start with less now since we also dig)
    const dirtCount = ws.getNumber('inv.dirt');
    if (dirtCount < 2) return 0;

    // HIGH priority - farms with actual issues need immediate attention
    // Higher than GatherDirt (30-50) and most other idle tasks
    // Scale with number of farms with issues
    return 80 + Math.min(farmsWithIssues * 10, 30); // 80-110
  }

  override isValid(ws: WorldState): boolean {
    const farmsWithIssues = ws.getNumber('state.farmsWithIssues');
    const hasStudied = ws.getBool('has.studiedSigns');
    const dirtCount = ws.getNumber('inv.dirt');
    const maintenanceNeeded = ws.getBool('state.farmMaintenanceNeeded');
    return maintenanceNeeded && hasStudied && farmsWithIssues > 0 && dirtCount >= 2;
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
 * Goal: Establish a dirtpit - dedicated dirt gathering location.
 * MEDIUM priority when no dirtpit exists and landscaper is idle.
 *
 * A dirtpit is a designated area with high dirt density, away from
 * the village center, farms, and forests. Once established, the landscaper
 * will preferentially gather dirt from this location and mark it with a sign.
 */
export class EstablishDirtpitGoal extends BaseGoal {
  name = 'EstablishDirtpit';
  description = 'Establish a dedicated dirt gathering location';

  conditions = [
    booleanGoalCondition('has.dirtpit', true, 'has established dirtpit'),
  ];

  getUtility(ws: WorldState): number {
    // Already have a dirtpit
    if (ws.getBool('has.dirtpit')) return 0;

    // Need village center first (to know where to avoid)
    const hasStudied = ws.getBool('has.studiedSigns');
    if (!hasStudied) return 0;

    // Don't establish if we have pending terraform work
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasPendingRequest) return 0;

    // Don't establish if actively terraforming
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 0;

    // Need shovel to actually gather dirt from the dirtpit
    const hasShovel = ws.getBool('has.shovel');
    if (!hasShovel) return 0;

    // Check if there's actual demand for dirt (known farms = potential work)
    const knownFarmCount = ws.getNumber('state.knownFarmCount');
    const hasKnownFarms = knownFarmCount > 0;

    // When there are known farms or potential work, establishing a dirtpit
    // is moderately important - be prepared for terraform requests
    if (hasKnownFarms) {
      return 45; // Higher than GatherDirt but below active work
    }

    // When truly idle with no farms known, establishing a dirtpit is
    // very low priority - just slightly above Explore as a "nice to have"
    // Don't send the bot off on a journey when there's nothing to prepare for
    return 12;
  }

  override isValid(ws: WorldState): boolean {
    const hasDirtpit = ws.getBool('has.dirtpit');
    const hasStudied = ws.getBool('has.studiedSigns');
    const hasShovel = ws.getBool('has.shovel');
    return !hasDirtpit && hasStudied && hasShovel;
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

  // Condition uses lower threshold (24) - utility function handles higher targets
  // when there are known farms. This prevents over-planning.
  conditions = [
    numericGoalCondition('inv.dirt', v => v >= 24, 'has enough dirt', {
      value: 24,
      comparison: 'gte',
      estimatedDelta: 16, // GatherDirt gives ~16 dirt per action
    }),
  ];

  getUtility(ws: WorldState): number {
    const dirtCount = ws.getNumber('inv.dirt');

    // Don't gather if we have pending terraform work
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasPendingRequest) return 0;

    // Don't gather if we're actively terraforming
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 0;

    // Don't gather if we need tools (get tools first)
    const hasShovel = ws.getBool('has.shovel');
    if (!hasShovel) return 0;

    // Don't gather if we don't have a dirtpit yet (establish first)
    const hasDirtpit = ws.getBool('has.dirtpit');
    if (!hasDirtpit) return 0;

    // Don't gather if inventory is full
    const inventoryFull = ws.getBool('state.inventoryFull');
    if (inventoryFull) return 0;

    // Check if there's actual demand for dirt
    const knownFarmCount = ws.getNumber('state.knownFarmCount');
    const hasKnownFarms = knownFarmCount > 0;

    // When there are known farms, keep a full stock of dirt (64)
    // Be prepared for terraform requests that might come
    if (hasKnownFarms) {
      if (dirtCount >= 64) return 0;
      const urgency = Math.max(0, (64 - dirtCount) / 64);
      return 30 + urgency * 15; // Range: 30-45
    }

    // When truly idle (no farms known), just maintain a small reserve (16-24)
    // No point hoarding dirt if there's nothing to terraform
    // This prevents the infinite gather-deposit loop
    const IDLE_DIRT_TARGET = 24;
    if (dirtCount >= IDLE_DIRT_TARGET) return 0;

    // Very low priority - just slightly above Explore
    // Having some dirt is nice but not worth wandering off for
    const urgency = Math.max(0, (IDLE_DIRT_TARGET - dirtCount) / IDLE_DIRT_TARGET);
    return 8 + urgency * 4; // Range: 8-12
  }

  override isValid(ws: WorldState): boolean {
    const dirtCount = ws.getNumber('inv.dirt');
    const hasShovel = ws.getBool('has.shovel');
    const hasDirtpit = ws.getBool('has.dirtpit');
    const knownFarmCount = ws.getNumber('state.knownFarmCount');

    // Target depends on whether there's actual work ahead
    const target = knownFarmCount > 0 ? 64 : 24;
    return dirtCount < target && hasShovel && hasDirtpit;
  }
}

/**
 * Goal: Read unknown signs spotted while exploring/working.
 * CURIOUS BOT behavior - when the bot sees a sign it hasn't read,
 * it will go investigate and potentially learn something useful.
 *
 * For landscapers, this is especially valuable because:
 * - They can discover new farms to check/maintain
 * - They can learn about water sources for terraforming decisions
 * - Signs placed by other bots contain useful coordinate info
 *
 * Lower priority than terraform work, but higher than idle.
 */
export class ReadUnknownSignGoal extends BaseGoal {
  name = 'ReadUnknownSign';
  description = 'Investigate and read an unknown sign';

  conditions = [
    numericGoalCondition('nearby.unknownSigns', v => v === 0, 'no unknown signs'),
  ];

  getUtility(ws: WorldState): number {
    const unknownCount = ws.getNumber('nearby.unknownSigns');
    if (unknownCount === 0) return 0;

    // Don't get distracted if actively terraforming
    const terraformActive = ws.getBool('terraform.active');
    if (terraformActive) return 0;

    // Don't get distracted if pending terraform request
    const hasPendingRequest = ws.getBool('has.pendingTerraformRequest');
    if (hasPendingRequest) return 20; // Very low priority - finish terraform first

    // Base utility of 60 - high enough to read signs before wandering off
    // to establish dirtpits or do low-priority exploration.
    // Signs are quick to read and provide valuable knowledge, so prioritize them
    // over tasks that would make the bot walk away and come back later.
    return 60 + Math.min(unknownCount * 5, 15);
  }

  override isValid(ws: WorldState): boolean {
    return ws.getNumber('nearby.unknownSigns') > 0;
  }
}

/**
 * Goal: Wait at spawn for terraform requests.
 * The landscaper should mostly idle until called by other bots or until
 * materials are available in the shared chest.
 *
 * Returns LOW utility as an absolute fallback - ensures there's always
 * a valid goal even when no farms are known and no requests pending.
 * This prevents "No valid goals, idling" spam in logs.
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
    // Landscaper should mostly wait at spawn - but return a small utility
    // as fallback to avoid "No valid goals, idling" when:
    // - No farms are known (farmer hasn't written FARM signs yet)
    // - No terraform requests pending
    // - No maintenance needed
    //
    // This ensures there's always a goal to select, preventing idle spam.
    // The bot will become more active when:
    // 1. FulfillTerraformRequest goal activates (pending request)
    // 2. ObtainTools goal activates (materials in chest)
    // 3. CheckKnownFarms activates (after FARM signs are written)
    const idleTicks = ws.getNumber('state.consecutiveIdleTicks');

    // Very low base utility - any real work beats this
    // Increases slightly if idle for a while to trigger movement
    return 5 + Math.min(10, idleTicks / 2);
  }

  override isValid(ws: WorldState): boolean {
    return true; // Always valid as fallback
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADE GOALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Goal: Complete an active trade.
 * HIGHEST priority when in a trade - finish what we started.
 *
 * The goal is satisfied when trade.status becomes 'done' or 'idle'.
 */
export class CompleteTradeGoal extends BaseGoal {
  name = 'CompleteTrade';
  description = 'Complete an active trade exchange';

  // Goal is satisfied when trade is done/idle
  conditions = [
    {
      key: 'trade.status',
      check: (value: any) => value === 'done' || value === 'idle' || !value,
      description: 'trade completed or idle',
    },
  ];

  getUtility(ws: WorldState): number {
    // Use computed boolean from WorldStateBuilder (single source of truth)
    if (!ws.getBool('trade.isActive')) return 0;

    // Very high priority - finish what we started
    return 150;
  }

  override isValid(ws: WorldState): boolean {
    return ws.getBool('trade.isActive');
  }
}

/**
 * Goal: Respond to trade offers for items we want.
 * VERY HIGH priority when there's an offer for something we need.
 * Trading should preempt most activities (utility > activity + 30 preemption threshold).
 *
 * The goal is satisfied when we've responded (trade.status == 'wanting')
 * or entered an active trade.
 *
 * For landscaper: Must be high enough to preempt active terraforming (120 + 30 = 150).
 * Using 160 to ensure trade offers are always responded to promptly.
 */
export class RespondToTradeOfferGoal extends BaseGoal {
  name = 'RespondToTradeOffer';
  description = 'Respond to trade offers for items we want';

  // Goal is satisfied when we've responded to an offer
  conditions = [
    {
      key: 'trade.status',
      check: (value: any) => value === 'wanting' || value === 'accepted' || value === 'traveling',
      description: 'responded to trade offer',
    },
  ];

  getUtility(ws: WorldState): number {
    // Use computed boolean from WorldStateBuilder (single source of truth)
    if (!ws.getBool('trade.canRespondToOffers')) return 0;

    // Very high priority - trading should preempt ALL activities including active terraform
    // Active terraform is 120, preemption threshold is 30, so need > 150
    // Using 160 to ensure trade offers can always interrupt
    return 160;
  }

  override isValid(ws: WorldState): boolean {
    return ws.getBool('trade.canRespondToOffers');
  }
}

/**
 * Goal: Broadcast trade offer for unwanted items.
 * LOW priority - only when idle with unwanted items.
 *
 * Note: The goal condition checks trade.status == 'offering' because that's
 * what the BroadcastTradeOfferAction achieves. The utility/isValid checks
 * ensure we only pursue this goal when we have items to trade.
 */
export class BroadcastTradeOfferGoal extends BaseGoal {
  name = 'BroadcastTradeOffer';
  description = 'Offer unwanted items for trade';

  // Goal is satisfied when offer process has completed (accepted/done)
  // NOT when idle - idle means we haven't started yet
  conditions = [
    {
      key: 'trade.status',
      check: (value: any) => value === 'done' || value === 'accepted',
      description: 'offer accepted or completed',
    },
  ];

  getUtility(ws: WorldState): number {
    const tradeStatus = ws.getString('trade.status');

    // HIGH priority if already offering - must finish collecting WANT responses
    if (tradeStatus === 'offering') {
      return 150;
    }

    // Use computed boolean from WorldStateBuilder (single source of truth)
    if (!ws.getBool('trade.canBroadcastOffer')) return 0;

    // Medium priority - trading is cooperative and should happen when idle
    // Base 40 + scaling ensures 8+ items beats Explore (45)
    // Range: 44 (4 items) to 60 (20+ items)
    const tradeableCount = ws.getNumber('trade.tradeableCount');
    return 40 + Math.min(tradeableCount / 4, 5) * 4;
  }

  override isValid(ws: WorldState): boolean {
    const tradeStatus = ws.getString('trade.status');

    // Valid if offering (need to continue) OR if ready to start a new offer
    if (tradeStatus === 'offering') return true;
    return ws.getBool('trade.canBroadcastOffer');
  }
}

/**
 * Registry of all landscaper goals.
 */
export function createLandscaperGoals(): BaseGoal[] {
  return [
    new CompleteTradeGoal(),      // Highest priority - finish active trades
    new StudySpawnSignsGoal(),    // Highest priority on spawn
    new FulfillTerraformRequestGoal(),
    new RespondToTradeOfferGoal(),// Respond to trade offers
    new CheckKnownFarmsGoal(),    // Proactive farm checking
    new MaintainFarmsGoal(),      // Actively maintain known farms
    new ObtainToolsGoal(),
    new DepositItemsGoal(),
    new CollectDropsGoal(),
    new EstablishDirtpitGoal(),   // Establish dirtpit before gathering
    new GatherDirtGoal(),         // Proactive dirt gathering when idle
    new CraftSlabsGoal(),         // Craft slabs for navigation scaffolding
    new BroadcastTradeOfferGoal(),// Offer unwanted items when idle
    new ReadUnknownSignGoal(),    // Curious bot - read unknown signs
    new ExploreGoal(),            // Always last - lowest priority fallback
  ];
}
