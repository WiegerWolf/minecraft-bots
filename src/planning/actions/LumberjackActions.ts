import type { Bot } from 'mineflayer';
import { BaseGOAPAction, ActionResult, numericPrecondition, booleanPrecondition, incrementEffect, setEffect } from '../Action';
import { WorldState } from '../WorldState';
import type { LumberjackBlackboard } from '../../roles/lumberjack/LumberjackBlackboard';
import {
  PickupItems,
  ChopTree,
  FinishTreeHarvest,
  DepositLogs,
  CraftAxe,
  FulfillRequests,
  ProcessWood,
  CraftChest,
  CraftAndPlaceCraftingTable,
  PatrolForest,
} from '../../roles/lumberjack/behaviors/actions';

/**
 * GOAP Action: Pick up dropped items
 */
export class PickupItemsAction extends BaseGOAPAction {
  name = 'PickupItems';
  private impl = new PickupItems();

  preconditions = [
    numericPrecondition('nearby.drops', v => v > 0, 'drops nearby'),
    booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
  ];

  effects = [
    setEffect('nearby.drops', 0, 'all drops collected'),
  ];

  override getCost(ws: WorldState): number {
    return 0.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Chop down a tree
 */
export class ChopTreeAction extends BaseGOAPAction {
  name = 'ChopTree';
  private impl = new ChopTree();

  preconditions = [
    numericPrecondition('nearby.trees', v => v > 0, 'trees available'),
    booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
  ];

  effects = [
    incrementEffect('inv.logs', 4, 'chopped logs'),
    setEffect('tree.active', true, 'tree harvest started'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Finish an in-progress tree harvest (leaves, replant)
 */
export class FinishTreeHarvestAction extends BaseGOAPAction {
  name = 'FinishTreeHarvest';
  private impl = new FinishTreeHarvest();

  preconditions = [
    booleanPrecondition('tree.active', true, 'tree harvest in progress'),
  ];

  effects = [
    setEffect('tree.active', false, 'tree harvest complete'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Deposit logs in chest
 */
export class DepositLogsAction extends BaseGOAPAction {
  name = 'DepositLogs';
  private impl = new DepositLogs();

  preconditions = [
    numericPrecondition('inv.logs', v => v > 0, 'has logs to deposit'),
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
  ];

  effects = [
    setEffect('inv.logs', 0, 'logs deposited'),
    setEffect('inv.planks', 0, 'planks deposited'),
    setEffect('inv.sticks', 0, 'sticks deposited'),
    setEffect('state.inventoryFull', false, 'inventory freed'),
    setEffect('needs.toDeposit', false, 'deposit complete'),
  ];

  override getCost(ws: WorldState): number {
    return 2.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a wooden axe
 * The implementation handles crafting planks/sticks internally.
 * Minimum requirement: 2 logs (will be converted to planks) or 5+ planks.
 */
export class CraftAxeAction extends BaseGOAPAction {
  name = 'CraftAxe';
  private impl = new CraftAxe();

  // Basic check - need at least 3 logs for: crafting table (4 planks) + sticks (2 planks) + axe (3 planks) = 9 planks = 3 logs
  // This allows the planner to chain ChopTree → CraftAxe
  preconditions = [
    booleanPrecondition('has.axe', false, 'no axe yet'),
    numericPrecondition('inv.logs', v => v >= 3, 'has enough logs for axe'),
  ];

  effects = [
    setEffect('has.axe', true, 'crafted axe'),
    incrementEffect('inv.logs', -3, 'used logs for axe crafting'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a wooden axe when we already have planks
 * This variant is for when we already have enough planks/sticks.
 * Need 9 planks worst case: crafting table (4) + sticks (2) + axe (3)
 */
export class CraftAxeFromPlanksAction extends BaseGOAPAction {
  name = 'CraftAxeFromPlanks';
  private impl = new CraftAxe();

  preconditions = [
    booleanPrecondition('has.axe', false, 'no axe yet'),
    // Need 9 planks worst case: crafting table (4) + sticks (2) + axe (3)
    // If crafting table exists nearby, fewer are needed, but planner can't know that
    numericPrecondition('inv.planks', v => v >= 9, 'has enough planks'),
  ];

  effects = [
    setEffect('has.axe', true, 'crafted axe'),
    incrementEffect('inv.planks', -9, 'used planks for table + sticks + axe'),
  ];

  override getCost(ws: WorldState): number {
    // Lower cost since we already have materials ready
    return 1.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Fulfill village requests for wood products
 */
export class FulfillRequestsAction extends BaseGOAPAction {
  name = 'FulfillRequests';
  private impl = new FulfillRequests();

  preconditions = [
    booleanPrecondition('has.pendingRequests', true, 'pending requests exist'),
  ];

  effects = [
    setEffect('has.pendingRequests', false, 'requests fulfilled'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Process logs into planks
 */
export class ProcessWoodAction extends BaseGOAPAction {
  name = 'ProcessWood';
  private impl = new ProcessWood();

  preconditions = [
    numericPrecondition('inv.logs', v => v >= 2, 'has logs to process'),
  ];

  effects = [
    incrementEffect('inv.planks', 8, 'created planks'),
    incrementEffect('inv.logs', -2, 'used logs'),
  ];

  override getCost(ws: WorldState): number {
    return 1.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a chest for storage
 */
export class CraftChestAction extends BaseGOAPAction {
  name = 'CraftChest';
  private impl = new CraftChest();

  preconditions = [
    booleanPrecondition('derived.needsChest', true, 'needs chest'),
    booleanPrecondition('derived.hasVillage', true, 'has village center'),
    numericPrecondition('inv.planks', v => v >= 8, 'has planks for chest'),
  ];

  effects = [
    setEffect('derived.needsChest', false, 'has chest now'),
    setEffect('derived.hasStorageAccess', true, 'has storage access'),
    incrementEffect('inv.planks', -8, 'used planks'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft and place a crafting table
 */
export class CraftAndPlaceCraftingTableAction extends BaseGOAPAction {
  name = 'CraftAndPlaceCraftingTable';
  private impl = new CraftAndPlaceCraftingTable();

  preconditions = [
    booleanPrecondition('derived.needsCraftingTable', true, 'needs crafting table'),
    booleanPrecondition('derived.hasVillage', true, 'has village center'),
    numericPrecondition('inv.planks', v => v >= 4, 'has planks for table'),
  ];

  effects = [
    setEffect('derived.needsCraftingTable', false, 'has crafting table now'),
    setEffect('has.craftingTable', true, 'crafting table available'),
    incrementEffect('inv.planks', -4, 'used planks'),
  ];

  override getCost(ws: WorldState): number {
    return 2.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Patrol to find trees
 */
export class PatrolForestAction extends BaseGOAPAction {
  name = 'PatrolForest';
  private impl = new PatrolForest();

  preconditions = [
    // Always applicable - fallback action
  ];

  effects = [
    // Exploration may find trees - optimistically assume we'll find some
    setEffect('nearby.trees', 1, 'may find trees'),
    setEffect('state.consecutiveIdleTicks', 0, 'explored'),
  ];

  override getCost(ws: WorldState): number {
    // High cost - exploration is expensive and unpredictable
    return 10.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * Create all lumberjack actions for the planner.
 */
export function createLumberjackActions(): BaseGOAPAction[] {
  return [
    new PickupItemsAction(),
    new ChopTreeAction(),
    new FinishTreeHarvestAction(),
    new DepositLogsAction(),
    new CraftAxeAction(),
    new CraftAxeFromPlanksAction(), // Variant when we have planks ready
    new FulfillRequestsAction(),
    new ProcessWoodAction(),
    new CraftChestAction(),
    new CraftAndPlaceCraftingTableAction(),
    new PatrolForestAction(),
  ];
}
