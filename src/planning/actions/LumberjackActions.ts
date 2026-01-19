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
  RespondToNeed,
  ProcessWood,
  CraftChest,
  CraftAndPlaceCraftingTable,
  PlaceStorageChest,
  PatrolForest,
  PlantSaplings,
  WriteKnowledgeSign,
  FindForest,
  StudySpawnSigns,
  WithdrawSupplies,
  ReadUnknownSign,
  BroadcastOffer,
  RespondToOffer,
  CompleteTrade,
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
 * IMPORTANT: Only chops trees in actual forests (not buildings!)
 * Uses nearby.forestTrees instead of nearby.trees.
 */
export class ChopTreeAction extends BaseGOAPAction {
  name = 'ChopTree';
  private impl = new ChopTree();

  preconditions = [
    // SAFETY: Only target trees in forests - not isolated logs or structures
    numericPrecondition('nearby.forestTrees', v => v > 0, 'forest trees available'),
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
 * GOAP Action: Respond to incoming needs from other bots
 */
export class RespondToNeedAction extends BaseGOAPAction {
  name = 'RespondToNeed';
  private impl = new RespondToNeed();

  preconditions = [
    booleanPrecondition('has.incomingNeeds', true, 'incoming needs exist'),
    // Need logs to provide wood products
    numericPrecondition('inv.logs', v => v >= 2, 'has logs to provide'),
  ];

  effects = [
    setEffect('has.incomingNeeds', false, 'needs fulfilled'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
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
 * GOAP Action: Place a storage chest near village center
 * IMPORTANT: Places our own chest rather than adopting random found chests.
 * This ensures the chest is in an accessible location.
 */
export class PlaceStorageChestAction extends BaseGOAPAction {
  name = 'PlaceStorageChest';
  private impl = new PlaceStorageChest();

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
 * GOAP Action: Craft a chest for storage (legacy - kept for compatibility)
 * @deprecated Use PlaceStorageChestAction instead
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
    // Higher cost than PlaceStorageChest to prefer the new action
    return 4.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft and place a crafting table
 * Will establish village center at current position if needed
 */
export class CraftAndPlaceCraftingTableAction extends BaseGOAPAction {
  name = 'CraftAndPlaceCraftingTable';
  private impl = new CraftAndPlaceCraftingTable();

  preconditions = [
    booleanPrecondition('derived.needsCraftingTable', true, 'needs crafting table'),
    // Removed: derived.hasVillage - action will establish village center if needed
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
 * GOAP Action: Plant saplings to sustain the forest
 * Plants saplings when bot has them and isn't actively harvesting a tree
 */
export class PlantSaplingsAction extends BaseGOAPAction {
  name = 'PlantSaplings';
  private impl = new PlantSaplings();

  preconditions = [
    numericPrecondition('inv.saplings', v => v > 0, 'has saplings'),
    booleanPrecondition('tree.active', false, 'no active tree harvest'),
  ];

  effects = [
    incrementEffect('inv.saplings', -1, 'planted sapling'),
  ];

  override getCost(ws: WorldState): number {
    // Low cost - planting is quick and important for sustainability
    return 1.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Write knowledge to signs at spawn
 * Records infrastructure locations (village center, crafting table, chest) to signs
 * for persistence across bot restarts.
 *
 * Sign crafting requires: 6 planks + 1 stick at a crafting table.
 * The action will succeed if:
 * - Bot already has a sign in inventory, OR
 * - Bot has materials (6 planks, 1 stick) and access to a crafting table
 */
export class WriteKnowledgeSignAction extends BaseGOAPAction {
  name = 'WriteKnowledgeSign';
  private impl = new WriteKnowledgeSign();

  // Preconditions array is empty because we use custom checkPreconditions for OR logic
  preconditions = [
    numericPrecondition('pending.signWrites', v => v > 0, 'has pending sign writes'),
  ];

  effects = [
    incrementEffect('pending.signWrites', -1, 'wrote sign'),
    // Assume we need to craft (pessimistic for planning)
    // If we already have a sign, these won't actually be consumed at runtime
    incrementEffect('inv.planks', -6, 'used planks for sign'),
    incrementEffect('inv.sticks', -1, 'used stick for sign'),
  ];

  /**
   * Custom precondition check with OR logic:
   * - has.sign == true (already have a sign), OR
   * - derived.canCraftSign == true (can craft: 6 planks + 1 stick + crafting table)
   *
   * For planner chaining, we also accept raw material checks so ProcessWood can satisfy:
   * - inv.planks >= 6 AND inv.sticks >= 1 (with implicit crafting table)
   */
  override checkPreconditions(ws: WorldState): boolean {
    const pendingWrites = ws.getNumber('pending.signWrites');
    if (pendingWrites <= 0) return false;

    // Already have a sign - can write immediately
    const hasSign = ws.getBool('has.sign');
    if (hasSign) return true;

    // Can craft a sign (derived fact checks planks, sticks, and crafting table access)
    const canCraft = ws.getBool('derived.canCraftSign');
    if (canCraft) return true;

    // For planner chaining: check raw materials (ProcessWood effects can satisfy this)
    // This allows plans like ProcessWood → WriteKnowledgeSign
    const planks = ws.getNumber('inv.planks');
    const sticks = ws.getNumber('inv.sticks');
    if (planks >= 6 && sticks >= 1) return true;

    return false;
  }

  override getCost(ws: WorldState): number {
    // Lower cost if we already have a sign
    const hasSign = ws.getBool('has.sign');
    if (hasSign) return 2.0;

    // Medium cost - requires navigation to spawn and crafting
    return 4.0;
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
    setEffect('nearby.forestTrees', 1, 'may find trees in forest'),
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
 * GOAP Action: Study signs at spawn (roleplay + learning)
 * Walks to spawn, looks at each sign, reads them, announces on village chat.
 * HIGHEST PRIORITY on fresh spawn.
 */
export class StudySpawnSignsAction extends BaseGOAPAction {
  name = 'StudySpawnSigns';
  private impl = new StudySpawnSigns();

  preconditions = [
    booleanPrecondition('has.studiedSigns', false, 'has not studied signs yet'),
  ];

  effects = [
    setEffect('has.studiedSigns', true, 'studied spawn signs'),
  ];

  override getCost(ws: WorldState): number {
    // Very low cost - this is a priority action on spawn
    return 1.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Check storage for useful supplies on spawn
 * Goes to chest, takes useful items (axes, logs, planks).
 * VERY HIGH priority when no tools and storage available.
 */
export class WithdrawSuppliesAction extends BaseGOAPAction {
  name = 'WithdrawSupplies';
  private impl = new WithdrawSupplies();

  preconditions = [
    booleanPrecondition('has.checkedStorage', false, 'has not checked storage yet'),
    booleanPrecondition('derived.hasStorageAccess', true, 'has storage access'),
  ];

  effects = [
    setEffect('has.checkedStorage', true, 'checked storage'),
    // Optimistically assume we might get an axe
    setEffect('has.axe', true, 'may have found axe'),
  ];

  override getCost(ws: WorldState): number {
    // Low cost - checking storage is valuable
    return 1.5;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Read an unknown sign (curious bot behavior)
 * When the bot spots a sign it hasn't read, it investigates.
 */
export class ReadUnknownSignAction extends BaseGOAPAction {
  name = 'ReadUnknownSign';
  private impl = new ReadUnknownSign();

  preconditions = [
    numericPrecondition('nearby.unknownSigns', v => v > 0, 'unknown signs nearby'),
  ];

  effects = [
    incrementEffect('nearby.unknownSigns', -1, 'read a sign'),
  ];

  override getCost(ws: WorldState): number {
    // Low cost - reading signs is quick and potentially valuable
    return 2.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Broadcast a trade offer for unwanted items
 */
export class BroadcastTradeOfferAction extends BaseGOAPAction {
  name = 'BroadcastTradeOffer';
  private impl = new BroadcastOffer();

  preconditions = [
    numericPrecondition('trade.tradeableCount', v => v >= 4, 'has tradeable items'),
    booleanPrecondition('trade.inTrade', false, 'not in trade'),
    booleanPrecondition('trade.onCooldown', false, 'not on cooldown'),
  ];

  // Effect is 'accepted' because the action broadcasts, waits for responses,
  // and accepts the best offer. 'offering' is just an intermediate state.
  effects = [
    setEffect('trade.status', 'accepted', 'trade accepted'),
  ];

  override getCost(ws: WorldState): number {
    return 1.0;
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Respond to a trade offer for items we want
 */
export class RespondToTradeOfferAction extends BaseGOAPAction {
  name = 'RespondToTradeOffer';
  private impl = new RespondToOffer();

  preconditions = [
    numericPrecondition('trade.pendingOffers', v => v > 0, 'has pending offers'),
    booleanPrecondition('trade.inTrade', false, 'not in trade'),
  ];

  effects = [
    setEffect('trade.status', 'wanting', 'responded to offer'),
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
 * GOAP Action: Complete an active trade
 */
export class CompleteTradeAction extends BaseGOAPAction {
  name = 'CompleteTrade';
  private impl = new CompleteTrade();

  preconditions = [
    // Active trade statuses
    {
      key: 'trade.status',
      check: (value: any) => {
        const activeStatuses = ['accepted', 'traveling', 'ready', 'dropping', 'picking_up'];
        return activeStatuses.includes(value);
      },
      description: 'has active trade',
    },
  ];

  effects = [
    setEffect('trade.status', 'done', 'trade completed'),
    setEffect('trade.inTrade', false, 'no longer in trade'),
  ];

  override getCost(ws: WorldState): number {
    return 0.5; // Very low cost - completing trades is important
  }

  override async execute(bot: Bot, bb: LumberjackBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Find a forest area to work in
 * Explores to find clusters of 3+ trees, marks as known forest.
 */
export class FindForestAction extends BaseGOAPAction {
  name = 'FindForest';
  private impl = new FindForest();

  preconditions = [
    booleanPrecondition('has.studiedSigns', true, 'has studied signs'),
    booleanPrecondition('has.knownForest', false, 'no known forest yet'),
  ];

  effects = [
    setEffect('has.knownForest', true, 'found a forest'),
    setEffect('nearby.forestTrees', 3, 'found trees in forest'),
  ];

  override getCost(ws: WorldState): number {
    // Higher cost - exploration is expensive
    return 8.0;
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
    // Trade actions (high priority when applicable)
    new CompleteTradeAction(),
    new RespondToTradeOfferAction(),
    new BroadcastTradeOfferAction(),

    // Regular actions
    new StudySpawnSignsAction(),   // Startup: study signs first
    new WithdrawSuppliesAction(),  // Startup: check chest for supplies
    new FindForestAction(),        // Find a forest before chopping
    new PickupItemsAction(),
    new ChopTreeAction(),          // Only chops trees in forests!
    new FinishTreeHarvestAction(),
    new PlantSaplingsAction(),
    new DepositLogsAction(),
    new CraftAxeAction(),
    new CraftAxeFromPlanksAction(), // Variant when we have planks ready
    new RespondToNeedAction(),
    new ProcessWoodAction(),
    new PlaceStorageChestAction(),  // Place our own chest (preferred)
    new CraftChestAction(),          // Legacy chest crafting
    new CraftAndPlaceCraftingTableAction(),
    new WriteKnowledgeSignAction(), // Handles FOREST and infrastructure signs
    new ReadUnknownSignAction(),   // Curious bot - read unknown signs
    new PatrolForestAction(),
  ];
}
