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
 * High priority - inter-bot coordination.
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

    // Higher utility if we have materials to fulfill
    const hasMaterials = logCount > 0 || plankCount > 0;
    return hasMaterials ? 110 : 80;
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

    // Can craft right now - high priority
    if (canCraft) return 80;

    // Check if we have any path to getting materials
    const logCount = ws.getNumber('inv.logs');
    const plankCount = ws.getNumber('inv.planks');
    const treeCount = ws.getNumber('nearby.reachableTrees');

    // If we have logs, we can process them to planks
    // Need at least 2 logs to get 8 planks (enough to make sticks + axe head)
    if (logCount >= 2 || plankCount >= 3) {
      return 70; // Can get materials soon
    }

    // If we have some logs/planks and reachable trees nearby, still viable
    if ((logCount >= 1 || plankCount >= 1) && treeCount > 0) {
      return 60;
    }

    // No materials and no reachable trees - can't craft, return 0 to let other goals (like Patrol) run
    return 0;
  }
}

/**
 * Goal: Deposit logs in storage.
 * High priority when inventory is full or have many logs.
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

    if (logCount === 0 || !hasStorage) return 0;

    // Very high priority when inventory full
    if (inventoryFull) return 90;

    // High priority when we have many logs
    if (needsToDeposit || logCount >= 32) return 80;
    if (logCount >= 16) return 70;
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
 * Goal: Patrol forest to find trees.
 * LOWEST PRIORITY - fallback when nothing else to do.
 *
 * This goal is satisfied when the bot is not idle (consecutiveIdleTicks == 0).
 * The patrol action resets idle ticks, so completing a patrol satisfies this goal.
 * This prevents the "already satisfied" problem when trees exist but other goals fail.
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
    if (reachableTreeCount === 0) return 25;

    // When we have trees but keep being idle (planning failures), increase utility
    // This helps break out of "stuck" states
    if (idleTicks > 5) {
      return 15 + Math.min(25, idleTicks / 2);
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
 * Registry of all lumberjack goals.
 */
export function createLumberjackGoals(): BaseGoal[] {
  return [
    new CollectDropsGoal(),
    new FulfillRequestsGoal(),
    new CompleteTreeHarvestGoal(),
    new ObtainAxeGoal(),
    new DepositLogsGoal(),
    new ChopTreeGoal(),
    new CraftInfrastructureGoal(),
    new ProcessWoodGoal(),
    new PatrolForestGoal(), // Always last - lowest priority fallback
  ];
}
