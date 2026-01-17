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
 * Goal: Fulfill pending village requests for wood products.
 * VERY HIGH priority - farmer is waiting for materials!
 */
export class FulfillRequestsGoal extends BaseGoal {
  name = 'FulfillRequests';
  description = 'Fulfill pending village requests for wood';

  conditions = [
    booleanGoalCondition('has.pendingRequests', false, 'no pending requests'),
  ];

  getUtility(ws: WorldState): number {
    const hasPending = ws.getBool('has.pendingRequests');
    const logCount = ws.getNumber('inv.logs');
    const plankCount = ws.getNumber('inv.planks');

    if (!hasPending) return 0;

    // VERY high utility if we have materials - farmer is waiting!
    const hasMaterials = logCount > 0 || plankCount > 0;
    return hasMaterials ? 120 : 85;  // Boosted: 110->120, 80->85
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
    const hasPendingRequests = ws.getBool('has.pendingRequests');

    if (logCount === 0 || !hasStorage) return 0;

    // Very high priority when inventory full
    if (inventoryFull) return 90;

    // High priority when there are pending requests - farmer is waiting!
    if (hasPendingRequests && logCount > 0) return 85;

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
    // Use reachableTrees to only consider trees we can actually get to
    const treeCount = ws.getNumber('nearby.reachableTrees');
    const inventoryFull = ws.getBool('state.inventoryFull');
    const logCount = ws.getNumber('inv.logs');

    // Goal is satisfied when we have 16+ logs - no need to chop more
    if (logCount >= 16) return 0;

    if (inventoryFull || treeCount === 0) return 0;

    // Scale with available trees, but reduce if already have lots of logs
    const baseUtility = Math.min(70, 50 + treeCount * 2);
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
 * Medium priority - important for persistence but not urgent.
 *
 * This goal activates when there are pending sign writes in the queue
 * (after placing crafting tables, chests, or establishing village center).
 * Writing signs ensures the bot can recover this knowledge after restarts.
 */
export class WriteKnowledgeSignGoal extends BaseGoal {
  name = 'WriteKnowledgeSign';
  description = 'Write infrastructure locations to signs at spawn';

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

    // Medium-high priority when there are signs to write
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

  // Patrol is always valid
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
    new StudySpawnSignsGoal(),    // Highest priority on spawn
    new WithdrawSuppliesGoal(),   // Very high priority when no tools
    new CollectDropsGoal(),
    new FulfillRequestsGoal(),
    new CompleteTreeHarvestGoal(),
    new ObtainAxeGoal(),
    new DepositLogsGoal(),
    new ChopTreeGoal(),
    new PlantSaplingsGoal(),
    new WriteKnowledgeSignGoal(),
    new CraftInfrastructureGoal(),
    new ProcessWoodGoal(),
    new ReadUnknownSignGoal(),    // Curious bot - read unknown signs
    new PatrolForestGoal(), // Always last - lowest priority fallback
  ];
}
