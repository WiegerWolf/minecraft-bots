import { BaseGoal, numericGoalCondition, booleanGoalCondition } from '../Goal';
import { WorldState } from '../WorldState';

/**
 * Maximum water distance (in blocks) the bot can swim without a boat.
 * Beyond this distance, exploration actions require a boat.
 * This prevents the lumberjack from swimming across oceans to find forests.
 */
export const MAX_SWIMMING_DISTANCE = 20;

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
 * Goal: Fulfill incoming needs from other bots.
 * VERY HIGH priority - other bots are waiting for materials!
 */
export class FulfillNeedsGoal extends BaseGoal {
  name = 'FulfillNeeds';
  description = 'Respond to incoming needs from other bots';

  conditions = [
    booleanGoalCondition('has.incomingNeeds', false, 'no incoming needs'),
  ];

  getUtility(ws: WorldState): number {
    const hasNeeds = ws.getBool('has.incomingNeeds');
    if (!hasNeeds) return 0;

    // Use computed blackboard value (matches RespondToNeed.canSpareItems thresholds)
    const canSpare = ws.getBool('can.spareForNeeds');

    // VERY high utility if we can spare materials - other bots are waiting!
    // Return 0 if we can't spare - let ChopTree/ProcessWood gather materials first.
    // This prevents planning failures where the goal is selected but the action
    // precondition (can.spareForNeeds = true) can't be satisfied.
    if (!canSpare) return 0;

    return 120;
  }
}

/**
 * Goal: Complete an in-progress tree harvest.
 * High priority to finish started work.
 */
export class CompleteTreeHarvestGoal extends BaseGoal {
  name = 'CompleteTreeHarvest';
  description = 'Complete the current tree harvest';

  conditions = [
    booleanGoalCondition('tree.active', false, 'tree harvest complete'),
  ];

  getUtility(ws: WorldState): number {
    const treeActive = ws.getBool('tree.active');
    if (!treeActive) return 0;

    // High priority to finish what we started
    return 85;
  }
}

/**
 * Goal: Obtain an axe for efficient tree chopping.
 * High priority when no axe available and materials exist.
 */
export class ObtainAxeGoal extends BaseGoal {
  name = 'ObtainAxe';
  description = 'Craft or find an axe';

  conditions = [
    booleanGoalCondition('has.axe', true, 'has axe'),
  ];

  getUtility(ws: WorldState): number {
    const hasAxe = ws.getBool('has.axe');
    const canCraft = ws.getBool('derived.canCraftAxe');

    if (hasAxe) return 0;

    const logCount = ws.getNumber('inv.logs');
    const plankCount = ws.getNumber('inv.planks');
    const treeCount = ws.getNumber('nearby.reachableTrees');

    // Calculate total "plank equivalent" materials
    // 1 log = 4 planks, we need ~9 planks for crafting table + axe
    const plankEquivalent = plankCount + (logCount * 4);

    // Can craft right now - VERY high priority (higher than CompleteTreeHarvest's 85)
    if (canCraft) return 95;

    // Have enough materials to make crafting table + axe (need ~9 planks = 3 logs)
    // This should be higher than ChopTree and CompleteTreeHarvest so bot stops to craft
    if (plankEquivalent >= 9) {
      return 90; // Stop everything and craft that axe!
    }

    // Have some materials, close to being able to craft
    if (plankEquivalent >= 4) {
      return 75; // High priority, just need a bit more
    }

    // Have at least 1 log, can start working towards axe
    if (logCount >= 1 || plankCount >= 1) {
      return 60;
    }

    // No materials but trees nearby - need to gather first
    if (treeCount > 0) {
      return 50;
    }

    // No materials and no reachable trees - can't craft
    return 0;
  }
}

/**
 * Goal: Deposit logs in storage.
 * High priority when inventory is full, have many logs, or pending requests.
 * Lower threshold (8+ logs) to ensure farmer gets materials quickly.
 */
export class DepositLogsGoal extends BaseGoal {
  name = 'DepositLogs';
  description = 'Deposit logs in chest';

  conditions = [
    numericGoalCondition('inv.logs', v => v < 5, 'few logs remaining', {
      value: 5,
      comparison: 'lte',
      estimatedDelta: -32, // Deposit action clears logs
    }),
  ];

  getUtility(ws: WorldState): number {
    const logCount = ws.getNumber('inv.logs');
    const inventoryFull = ws.getBool('state.inventoryFull');
    const hasStorage = ws.getBool('derived.hasStorageAccess');
    const needsToDeposit = ws.getBool('needs.toDeposit');
    const hasIncomingNeeds = ws.getBool('has.incomingNeeds');

    if (logCount === 0 || !hasStorage) return 0;

    // Goal condition is "logs < 5" - if satisfied, utility must be 0
    // to avoid empty plans being created repeatedly
    if (logCount < 5 && !inventoryFull && !hasIncomingNeeds) return 0;

    // Very high priority when inventory full
    if (inventoryFull) return 90;

    // High priority when there are incoming needs - other bots are waiting!
    // Deposit any logs we have so they can pick them up
    if (hasIncomingNeeds && logCount >= 5) return 85;

    // High priority when we have many logs (lowered threshold: 16->8)
    if (needsToDeposit || logCount >= 32) return 80;
    if (logCount >= 16) return 70;
    if (logCount >= 8) return 60;  // New: deposit at 8+ logs
    return 0;
  }
}

/**
 * Goal: Chop down trees to gather wood.
 * Core lumberjack activity.
 *
 * IMPORTANT: Only chops trees that are part of actual forests,
 * NOT isolated logs that might be part of village houses.
 * Uses nearby.forestTrees instead of nearby.reachableTrees.
 */
export class ChopTreeGoal extends BaseGoal {
  name = 'ChopTree';
  description = 'Chop down trees to gather wood';

  conditions = [
    numericGoalCondition('inv.logs', v => v >= 16, 'have some logs', {
      value: 16,
      comparison: 'gte',
      estimatedDelta: 4, // ~4 logs per tree chopped
    }),
  ];

  getUtility(ws: WorldState): number {
    // SAFETY: Only use forestTrees - trees verified to be in actual forests
    // This prevents dismantling villager houses!
    const forestTreeCount = ws.getNumber('nearby.forestTrees');
    const inventoryFull = ws.getBool('state.inventoryFull');
    const logCount = ws.getNumber('inv.logs');

    // Goal is satisfied when we have 16+ logs - no need to chop more
    if (logCount >= 16) return 0;

    // No forest trees = cannot chop (even if reachableTrees > 0)
    if (inventoryFull || forestTreeCount === 0) return 0;

    // Don't start new trees when FOREST sign is pending - write it first!
    // This ensures knowledge persists before we get distracted by more chopping.
    // Note: CompleteTreeHarvest (85) still finishes in-progress trees.
    const hasForestSign = ws.getBool('pending.hasForestSign');
    if (hasForestSign) return 0;

    // Scale with available forest trees, but reduce if already have lots of logs
    const baseUtility = Math.min(70, 50 + forestTreeCount * 2);
    const logPenalty = Math.min(20, logCount / 4);
    return Math.max(0, baseUtility - logPenalty);
  }
}

/**
 * Goal: Craft infrastructure (crafting table, chest) for the village.
 * Medium priority for village setup.
 */
export class CraftInfrastructureGoal extends BaseGoal {
  name = 'CraftInfrastructure';
  description = 'Craft crafting tables and chests for the village';

  conditions = [
    booleanGoalCondition('derived.needsCraftingTable', false, 'has crafting table access'),
    booleanGoalCondition('derived.needsChest', false, 'has chest access'),
  ];

  getUtility(ws: WorldState): number {
    const needsCraftingTable = ws.getBool('derived.needsCraftingTable');
    const needsChest = ws.getBool('derived.needsChest');
    const plankCount = ws.getNumber('inv.planks');
    const logCount = ws.getNumber('inv.logs');

    if (!needsCraftingTable && !needsChest) return 0;

    // Check if we have materials
    const hasMaterials = plankCount >= 4 || logCount >= 1;
    if (!hasMaterials) return 0;

    // Higher priority for crafting table (enables other crafting)
    if (needsCraftingTable) return 65;
    if (needsChest) return 45;
    return 0;
  }

  override isValid(ws: WorldState): boolean {
    const needsCraftingTable = ws.getBool('derived.needsCraftingTable');
    const needsChest = ws.getBool('derived.needsChest');
    return needsCraftingTable || needsChest;
  }
}

/**
 * Goal: Process wood into planks.
 * Low priority, done opportunistically.
 */
export class ProcessWoodGoal extends BaseGoal {
  name = 'ProcessWood';
  description = 'Convert logs to planks';

  conditions = [
    numericGoalCondition('inv.planks', v => v >= 16, 'have enough planks'),
  ];

  getUtility(ws: WorldState): number {
    const logCount = ws.getNumber('inv.logs');
    const plankCount = ws.getNumber('inv.planks');

    // Only process if we have logs and need planks
    if (logCount < 2 || plankCount >= 8) return 0;

    // Scale with need for planks
    if (plankCount === 0) return 50;
    if (plankCount < 4) return 40;
    return 30;
  }
}

/**
 * Goal: Plant saplings to sustain the forest.
 * Medium priority - important for sustainability but not urgent.
 *
 * This goal ensures the lumberjack replants trees after harvesting,
 * maintaining the forest for future wood gathering.
 */
export class PlantSaplingsGoal extends BaseGoal {
  name = 'PlantSaplings';
  description = 'Plant saplings to sustain the forest';

  conditions = [
    numericGoalCondition('inv.saplings', v => v === 0, 'no saplings to plant', {
      value: 0,
      comparison: 'eq',
      estimatedDelta: -1, // Plant one sapling per action
    }),
  ];

  getUtility(ws: WorldState): number {
    const saplingCount = ws.getNumber('inv.saplings');
    const treeActive = ws.getBool('tree.active');

    // Don't plant while actively harvesting (tree harvest handles that)
    if (treeActive) return 0;

    // No saplings = no utility
    if (saplingCount === 0) return 0;

    // Scale utility with number of saplings - more saplings = higher priority
    // Base: 55, scales up to 75 with many saplings
    return Math.min(75, 55 + saplingCount * 2);
  }

  override isValid(ws: WorldState): boolean {
    const saplingCount = ws.getNumber('inv.saplings');
    const treeActive = ws.getBool('tree.active');
    return saplingCount > 0 && !treeActive;
  }
}

/**
 * Goal: Write pending knowledge to signs at spawn.
 * Priority varies by sign type:
 * - FOREST: High priority (80) - helps future lumberjacks find forests immediately
 * - VILLAGE/CRAFT/CHEST: Medium priority (55-65) - infrastructure persistence
 *
 * This goal activates when there are pending sign writes in the queue
 * (after placing crafting tables, chests, establishing village center, or discovering forests).
 * Writing signs ensures the bot can recover this knowledge after restarts.
 */
export class WriteKnowledgeSignGoal extends BaseGoal {
  name = 'WriteKnowledgeSign';
  description = 'Write knowledge locations to signs at spawn';

  conditions = [
    numericGoalCondition('pending.signWrites', v => v === 0, 'no pending sign writes', {
      value: 0,
      comparison: 'eq',
      estimatedDelta: -1, // Each action writes one sign
    }),
  ];

  getUtility(ws: WorldState): number {
    const pendingCount = ws.getNumber('pending.signWrites');
    if (pendingCount === 0) return 0;

    // Check if FOREST sign is pending (highest priority sign type)
    const hasForestSign = ws.getBool('pending.hasForestSign');
    if (hasForestSign) {
      // High priority - helps future lumberjacks skip exploration
      // Should be higher than ChopTree (50-70) to write sign before harvesting
      return 80;
    }

    // Medium-high priority for infrastructure signs (VILLAGE, CRAFT, CHEST)
    // Utility scales with pending count to handle multiple writes
    // Range: 55-65 to be above PlantSaplings (55-75) but below critical goals
    return Math.min(65, 55 + pendingCount * 5);
  }

  override isValid(ws: WorldState): boolean {
    return ws.getNumber('pending.signWrites') > 0;
  }
}

/**
 * Goal: Patrol forest to find trees.
 * Low priority normally, but escalates when stuck.
 *
 * This goal is satisfied when the bot is not idle (consecutiveIdleTicks == 0).
 * The patrol action resets idle ticks, so completing a patrol satisfies this goal.
 *
 * Key behavior: When actions keep failing (idleTicks > 3), utility increases
 * to beat ObtainAxe (50) and break out of stuck states where trees are
 * reported but not actually reachable.
 */
/**
 * Goal: Complete an active trade exchange.
 * HIGHEST PRIORITY when in active trade - must finish what we started.
 */
export class CompleteTradeGoal extends BaseGoal {
  name = 'CompleteTrade';
  description = 'Complete an active trade exchange';

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
 * MEDIUM priority when there's an offer for something we need.
 */
export class RespondToTradeOfferGoal extends BaseGoal {
  name = 'RespondToTradeOffer';
  description = 'Respond to trade offers for items we want';

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

    // High priority - trading saves time vs gathering
    return 120;
  }

  override isValid(ws: WorldState): boolean {
    return ws.getBool('trade.canRespondToOffers');
  }
}

/**
 * Goal: Broadcast trade offer for unwanted items.
 * LOW priority to start - only when idle with unwanted items.
 * HIGH priority when already offering - must finish collecting WANT responses.
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

    // Low priority - do when idle, scale with tradeable items
    const tradeableCount = ws.getNumber('trade.tradeableCount');
    return 30 + Math.min(tradeableCount / 4, 5) * 4;
  }

  override isValid(ws: WorldState): boolean {
    const tradeStatus = ws.getString('trade.status');

    // Valid if offering (need to continue) OR if ready to start a new offer
    if (tradeStatus === 'offering') return true;
    return ws.getBool('trade.canBroadcastOffer');
  }
}

export class PatrolForestGoal extends BaseGoal {
  name = 'PatrolForest';
  description = 'Explore to find reachable trees';

  // Goal is satisfied when bot is not idle (any action resets idle ticks)
  // This ensures PatrolForest actually runs when selected, rather than
  // being marked "already satisfied" just because trees exist nearby.
  conditions = [
    numericGoalCondition('state.consecutiveIdleTicks', v => v === 0, 'not idle', {
      value: 0,
      comparison: 'eq',
      estimatedDelta: -1, // Patrol resets to 0
    }),
  ];

  getUtility(ws: WorldState): number {
    // Check for water crossing requirement first
    const waterAhead = ws.getNumber('exploration.waterAhead');
    const hasBoat = ws.getBool('has.boat');

    // If large water body ahead and no boat, can't patrol
    if (waterAhead >= MAX_SWIMMING_DISTANCE && !hasBoat) {
      return 0;
    }

    const reachableTreeCount = ws.getNumber('nearby.reachableTrees');
    const idleTicks = ws.getNumber('state.consecutiveIdleTicks');

    // High utility if no reachable trees - we need to find some
    if (reachableTreeCount === 0) return 45;

    // When we have trees but keep being idle (action failures), increase utility
    // This helps break out of "stuck" states where trees are reported but unreachable
    // Needs to beat ObtainAxe's utility of 50 when stuck
    if (idleTicks > 3) {
      // At idleTicks=4: 40 + 8 = 48
      // At idleTicks=6: 40 + 12 = 52 (beats ObtainAxe)
      // At idleTicks=10: 40 + 20 = 60
      // Cap at 70 to not override critical goals
      return 40 + Math.min(30, idleTicks * 2);
    }

    // Low base utility when everything is working
    return 5;
  }

  // Patrol is always valid unless blocked by water
  override isValid(ws: WorldState): boolean {
    return true;
  }
}

/**
 * Goal: Study signs at spawn to learn infrastructure locations.
 * HIGHEST PRIORITY on fresh spawn - roleplay reading signs.
 *
 * This goal activates only once when the bot first spawns and hasn't
 * studied signs yet. The bot will walk to spawn, look at each sign,
 * and announce what it learned on village chat.
 */
export class StudySpawnSignsGoal extends BaseGoal {
  name = 'StudySpawnSigns';
  description = 'Walk to spawn and study knowledge signs';

  conditions = [
    booleanGoalCondition('has.studiedSigns', true, 'has studied spawn signs'),
  ];

  getUtility(ws: WorldState): number {
    const hasStudied = ws.getBool('has.studiedSigns');
    if (hasStudied) return 0;

    // Very high priority on fresh spawn - do this first!
    return 200;
  }

  override isValid(ws: WorldState): boolean {
    return !ws.getBool('has.studiedSigns');
  }
}

/**
 * Goal: Check storage for useful supplies on spawn.
 * VERY HIGH PRIORITY when bot has no tools and knows about storage.
 *
 * This goal activates when the bot just spawned, has no axe, and knows
 * about a chest (from signs or village chat). Much faster than punching
 * trees to get started.
 */
export class WithdrawSuppliesGoal extends BaseGoal {
  name = 'WithdrawSupplies';
  description = 'Check storage for tools and materials';

  conditions = [
    booleanGoalCondition('has.checkedStorage', true, 'has checked storage'),
  ];

  getUtility(ws: WorldState): number {
    const hasChecked = ws.getBool('has.checkedStorage');
    if (hasChecked) return 0;

    const hasStorage = ws.getBool('derived.hasStorageAccess');
    if (!hasStorage) return 0;

    const hasAxe = ws.getBool('has.axe');
    const logCount = ws.getNumber('inv.logs');

    // Very high priority if we have no axe - check chest first!
    if (!hasAxe) return 180;

    // Medium-high if we have axe but low on materials
    if (logCount < 4) return 100;

    // Low priority if we're already equipped
    return 50;
  }

  override isValid(ws: WorldState): boolean {
    const hasChecked = ws.getBool('has.checkedStorage');
    const hasStorage = ws.getBool('derived.hasStorageAccess');
    return !hasChecked && hasStorage;
  }
}

/**
 * Goal: Find a forest area to work in.
 * HIGH PRIORITY when bot doesn't know about any forest yet.
 *
 * A forest is an area with 3+ trees clustered together.
 * Once found, the bot will mark it with a FOREST sign so future
 * lumberjacks can go there directly without searching.
 */
export class FindForestGoal extends BaseGoal {
  name = 'FindForest';
  description = 'Find a forest area with multiple trees';

  conditions = [
    booleanGoalCondition('has.knownForest', true, 'knows about a forest'),
  ];

  getUtility(ws: WorldState): number {
    const hasKnownForest = ws.getBool('has.knownForest');
    if (hasKnownForest) return 0;

    const hasStudiedSigns = ws.getBool('has.studiedSigns');
    // Wait for sign study first - might learn about forest from signs
    if (!hasStudiedSigns) return 0;

    const hasAxe = ws.getBool('has.axe');

    // Higher priority if we have an axe and are ready to work
    if (hasAxe) return 75;

    // Medium priority without axe - still need to find forest eventually
    return 55;
  }

  override isValid(ws: WorldState): boolean {
    const hasKnownForest = ws.getBool('has.knownForest');
    const hasStudiedSigns = ws.getBool('has.studiedSigns');

    // Can't explore if already know a forest or haven't studied signs
    if (hasKnownForest || !hasStudiedSigns) return false;

    // Check for water crossing requirement
    const waterAhead = ws.getNumber('exploration.waterAhead');
    const hasBoat = ws.getBool('has.boat');

    // If large water body ahead, require a boat
    if (waterAhead >= MAX_SWIMMING_DISTANCE && !hasBoat) {
      return false;
    }

    return true;
  }
}

/**
 * Goal: Read unknown signs spotted while exploring.
 * CURIOUS BOT behavior - when the bot sees a sign it hasn't read,
 * it will go investigate and potentially learn something useful.
 *
 * Lower priority than core work, but higher than patrol.
 * The bot should finish important tasks before getting distracted by signs.
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

    // Base utility of 45 - higher than patrol (35) but lower than most work
    // Increases slightly with more signs to encourage batch reading
    return 45 + Math.min(unknownCount * 5, 15);
  }

  override isValid(ws: WorldState): boolean {
    return ws.getNumber('nearby.unknownSigns') > 0;
  }
}

/**
 * Registry of all lumberjack goals.
 */
export function createLumberjackGoals(): BaseGoal[] {
  return [
    new CompleteTradeGoal(),      // Highest priority - finish active trades
    new StudySpawnSignsGoal(),    // Highest priority on spawn
    new WithdrawSuppliesGoal(),   // Very high priority when no tools
    new CollectDropsGoal(),
    new RespondToTradeOfferGoal(),// Respond to trade offers
    new FulfillNeedsGoal(),
    new FindForestGoal(),         // High priority when no known forest
    new CompleteTreeHarvestGoal(),
    new ObtainAxeGoal(),
    new DepositLogsGoal(),
    new ChopTreeGoal(),           // Only chops trees in forests (not houses!)
    new PlantSaplingsGoal(),
    new WriteKnowledgeSignGoal(), // Handles FOREST (priority 80) and infrastructure signs (55-65)
    new CraftInfrastructureGoal(),
    new ProcessWoodGoal(),
    new BroadcastTradeOfferGoal(),// Offer unwanted items when idle
    new ReadUnknownSignGoal(),    // Curious bot - read unknown signs
    new PatrolForestGoal(), // Always last - lowest priority fallback
  ];
}
