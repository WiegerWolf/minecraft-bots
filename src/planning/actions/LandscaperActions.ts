import type { Bot } from 'mineflayer';
import { BaseGOAPAction, ActionResult, numericPrecondition, booleanPrecondition, incrementEffect, setEffect } from '../Action';
import { WorldState } from '../WorldState';
import type { LandscaperBlackboard } from '../../roles/landscaper/LandscaperBlackboard';
import {
  PickupItems,
  TerraformArea,
  CraftShovel,
  CraftPickaxe,
  DepositItems,
  Explore,
  CheckSharedChest,
  BroadcastNeed,
  StudySpawnSigns,
  CheckFarmForTerraformNeeds,
  GatherDirt,
  CraftSlabs,
  MaintainFarm,
  ReadUnknownSign,
  BroadcastOffer,
  RespondToOffer,
  CompleteTrade,
} from '../../roles/landscaper/behaviors/actions';

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

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Terraform an area
 */
export class TerraformAreaAction extends BaseGOAPAction {
  name = 'TerraformArea';
  private impl = new TerraformArea();

  preconditions = [
    booleanPrecondition('has.pendingTerraformRequest', true, 'terraform request pending'),
    // Need at least one tool - check both individual flags and derived
    {
      key: 'has.shovel',
      check: (value: any) => {
        // This action is applicable if we have shovel OR pickaxe
        return true; // We'll check tools in a custom override
      },
      description: 'placeholder for tool check',
    },
  ];

  // Override to check for either shovel or pickaxe
  override checkPreconditions(ws: WorldState): boolean {
    const hasPending = ws.getBool('has.pendingTerraformRequest');
    const hasShovel = ws.getBool('has.shovel');
    const hasPickaxe = ws.getBool('has.pickaxe');
    const hasAnyTool = ws.getBool('derived.hasAnyTool');

    if (!hasPending) return false;
    if (!hasShovel && !hasPickaxe && !hasAnyTool) return false;

    return true;
  }

  effects = [
    setEffect('has.pendingTerraformRequest', false, 'terraform complete'),
    setEffect('terraform.active', false, 'no active terraform'),
  ];

  override getCost(ws: WorldState): number {
    // Terraforming is the main task - moderate cost
    return 5.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a shovel
 */
export class CraftShovelAction extends BaseGOAPAction {
  name = 'CraftShovel';
  private impl = new CraftShovel();

  // Need enough materials: 1 plank + 2 sticks (or logs to make them)
  // Worst case: 2 logs = 8 planks (enough for table + tool)
  preconditions = [
    booleanPrecondition('has.shovel', false, 'no shovel yet'),
    numericPrecondition('inv.logs', v => v >= 2, 'has enough logs'),
  ];

  override checkPreconditions(ws: WorldState): boolean {
    const hasShovel = ws.getBool('has.shovel');
    const logs = ws.getNumber('inv.logs');
    if (hasShovel) return false;
    if (logs < 2) return false;
    return true;
  }

  effects = [
    setEffect('has.shovel', true, 'crafted shovel'),
    incrementEffect('inv.logs', -2, 'used logs for crafting'),
    setEffect('derived.hasAnyTool', true, 'has digging tool'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a shovel when we already have planks
 */
export class CraftShovelFromPlanksAction extends BaseGOAPAction {
  name = 'CraftShovelFromPlanks';
  private impl = new CraftShovel();

  // Need: crafting table (4 planks) + 2 sticks (2 planks) + 1 plank = 7 planks
  preconditions = [
    booleanPrecondition('has.shovel', false, 'no shovel yet'),
    numericPrecondition('inv.planks', v => v >= 7, 'has enough planks'),
  ];

  effects = [
    setEffect('has.shovel', true, 'crafted shovel'),
    incrementEffect('inv.planks', -7, 'used planks'),
    setEffect('derived.hasAnyTool', true, 'has digging tool'),
  ];

  override getCost(ws: WorldState): number {
    return 2.5;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a pickaxe
 */
export class CraftPickaxeAction extends BaseGOAPAction {
  name = 'CraftPickaxe';
  private impl = new CraftPickaxe();

  // Need enough materials for pickaxe (3 planks head + 2 sticks)
  preconditions = [
    booleanPrecondition('has.pickaxe', false, 'no pickaxe yet'),
    numericPrecondition('inv.logs', v => v >= 2, 'has enough logs'),
  ];

  effects = [
    setEffect('has.pickaxe', true, 'crafted pickaxe'),
    incrementEffect('inv.logs', -2, 'used logs for crafting'),
    setEffect('derived.hasAnyTool', true, 'has digging tool'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a pickaxe from planks
 */
export class CraftPickaxeFromPlanksAction extends BaseGOAPAction {
  name = 'CraftPickaxeFromPlanks';
  private impl = new CraftPickaxe();

  // Need: crafting table (4 planks) + 2 sticks (2 planks) + 3 planks = 9 planks
  preconditions = [
    booleanPrecondition('has.pickaxe', false, 'no pickaxe yet'),
    numericPrecondition('inv.planks', v => v >= 9, 'has enough planks'),
  ];

  effects = [
    setEffect('has.pickaxe', true, 'crafted pickaxe'),
    incrementEffect('inv.planks', -9, 'used planks'),
    setEffect('derived.hasAnyTool', true, 'has digging tool'),
  ];

  override getCost(ws: WorldState): number {
    return 2.5;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Deposit items to chest
 */
export class DepositItemsAction extends BaseGOAPAction {
  name = 'DepositItems';
  private impl = new DepositItems();

  preconditions = [
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
    numericPrecondition('inv.dirt', v => v > 0, 'has items to deposit'),
  ];

  effects = [
    setEffect('inv.dirt', 0, 'dirt deposited'),
    setEffect('inv.cobblestone', 0, 'cobblestone deposited'),
    setEffect('state.inventoryFull', false, 'inventory freed'),
    setEffect('needs.toDeposit', false, 'deposit complete'),
  ];

  override getCost(ws: WorldState): number {
    return 2.5;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Explore/patrol for terraform requests
 */
export class ExploreAction extends BaseGOAPAction {
  name = 'Explore';
  private impl = new Explore();

  preconditions = [
    // Always applicable - fallback action
  ];

  effects = [
    setEffect('state.consecutiveIdleTicks', 0, 'explored'),
  ];

  override getCost(ws: WorldState): number {
    // High cost - exploration is lowest priority
    return 10.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Check shared chest for materials
 */
export class CheckSharedChestAction extends BaseGOAPAction {
  name = 'CheckSharedChest';
  private impl = new CheckSharedChest();

  preconditions = [
    // Need to have a shared chest available
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
    // Only check chest when we need logs for tools
    numericPrecondition('inv.logs', v => v < 2, 'needs logs'),
  ];

  override checkPreconditions(ws: WorldState): boolean {
    const hasStorageAccess = ws.getBool('derived.hasStorageAccess');
    const logs = ws.getNumber('inv.logs');
    if (!hasStorageAccess) return false;
    if (logs >= 2) return false;
    return true;
  }

  effects = [
    // Optimistically assume we'll get logs
    setEffect('inv.logs', 4, 'retrieved logs from chest'),
  ];

  override getCost(ws: WorldState): number {
    // Low cost - checking chest is a quick way to get materials
    return 1.5;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Broadcast need for tools via the intent-based need system
 *
 * This action broadcasts a need for shovel/pickaxe. Other bots can offer
 * to provide the item directly, crafting materials, or raw materials.
 * Returns SUCCESS when need is broadcast (action runs asynchronously).
 */
export class BroadcastNeedAction extends BaseGOAPAction {
  name = 'BroadcastNeed';
  private impl = new BroadcastNeed();

  preconditions = [
    // Need tools but don't have materials
    booleanPrecondition('needs.tools', true, 'needs tools'),
    numericPrecondition('inv.logs', v => v < 2, 'needs logs'),
    // Only broadcast if we have chest access (where delivery may happen)
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
  ];

  effects = [
    // Broadcasting a need starts the process of getting tools
    setEffect('state.needBroadcast', true, 'need broadcast'),
  ];

  override getCost(ws: WorldState): number {
    // Higher cost since this requires waiting for provider
    return 3.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Study signs near spawn to learn about farms
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
    // Low cost - quick to do and enables farm checking
    return 1.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Check a known farm for terraform needs
 */
export class CheckFarmForTerraformNeedsAction extends BaseGOAPAction {
  name = 'CheckFarmForTerraformNeeds';
  private impl = new CheckFarmForTerraformNeeds();

  preconditions = [
    booleanPrecondition('has.studiedSigns', true, 'has studied signs'),
    numericPrecondition('state.farmsNeedingCheck', v => v > 0, 'has farms to check'),
  ];

  effects = [
    // Each check removes one farm from the check list
    incrementEffect('state.farmsNeedingCheck', -1, 'checked one farm'),
  ];

  override getCost(ws: WorldState): number {
    // Moderate cost - involves travel but enables proactive work
    return 3.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Gather dirt proactively when idle
 */
export class GatherDirtAction extends BaseGOAPAction {
  name = 'GatherDirt';
  private impl = new GatherDirt();

  preconditions = [
    booleanPrecondition('has.shovel', true, 'has shovel'),
    numericPrecondition('inv.dirt', v => v < 64, 'needs more dirt'),
    booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
  ];

  effects = [
    // Optimistically assume we gather a batch of dirt
    incrementEffect('inv.dirt', 16, 'gathered dirt'),
  ];

  override getCost(ws: WorldState): number {
    // Moderate cost - better than idling but not urgent
    return 4.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft wooden slabs for navigation scaffolding
 */
export class CraftSlabsAction extends BaseGOAPAction {
  name = 'CraftSlabs';
  private impl = new CraftSlabs();

  preconditions = [
    numericPrecondition('inv.planks', v => v >= 3, 'has planks for slabs'),
    numericPrecondition('inv.slabs', v => v < 16, 'needs more slabs'),
  ];

  effects = [
    // 3 planks -> 6 slabs
    incrementEffect('inv.slabs', 6, 'crafted slabs'),
    incrementEffect('inv.planks', -3, 'used planks'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GOAP Action: Broadcast a trade offer for unwanted items
 */
export class BroadcastTradeOfferAction extends BaseGOAPAction {
  name = 'BroadcastTradeOffer';
  private impl = new BroadcastOffer();

  preconditions = [
    numericPrecondition('trade.tradeableCount', v => v >= 4, 'has tradeable items'),
    booleanPrecondition('trade.onCooldown', false, 'not on cooldown'),
  ];

  // Custom precondition check: allow starting new offer OR continuing existing one
  override checkPreconditions(ws: WorldState): boolean {
    const tradeableCount = ws.getNumber('trade.tradeableCount');
    const onCooldown = ws.getBool('trade.onCooldown');
    const tradeStatus = ws.getString('trade.status');
    const inTrade = ws.getBool('trade.inTrade');

    // Always allow if already offering (need to continue collecting WANTs and accept)
    if (tradeStatus === 'offering') return true;

    // For starting a new offer: need items, not on cooldown, not in another trade
    if (tradeableCount < 4) return false;
    if (onCooldown) return false;
    if (inTrade) return false;

    return true;
  }

  // Effect is 'accepted' because the action broadcasts, waits for responses,
  // and accepts the best offer. 'offering' is just an intermediate state.
  effects = [
    setEffect('trade.status', 'accepted', 'trade accepted'),
  ];

  override getCost(ws: WorldState): number {
    return 1.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
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

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
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

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Maintain and repair known farms
 *
 * Proactively visits known farms to fix:
 * - Stacked water (water below central water source)
 * - Spreading water
 * - Holes in farm surface
 */
export class MaintainFarmsAction extends BaseGOAPAction {
  name = 'MaintainFarms';
  private impl = new MaintainFarm();

  preconditions = [
    booleanPrecondition('has.studiedSigns', true, 'has studied signs'),
    numericPrecondition('state.knownFarmCount', v => v > 0, 'has known farms'),
    numericPrecondition('inv.dirt', v => v >= 4, 'has dirt for repairs'),
  ];

  effects = [
    setEffect('state.farmMaintenanceNeeded', false, 'farms maintained'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0; // Moderate cost - maintenance is ongoing
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Read unknown signs spotted while exploring/working.
 * Curious bot behavior - investigate signs to potentially learn useful info.
 */
export class ReadUnknownSignAction extends BaseGOAPAction {
  name = 'ReadUnknownSign';
  private impl = new ReadUnknownSign();

  preconditions = [
    numericPrecondition('nearby.unknownSigns', v => v > 0, 'unknown signs nearby'),
  ];

  effects = [
    incrementEffect('nearby.unknownSigns', -1, 'read one sign'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0;
  }

  override async execute(bot: Bot, bb: LandscaperBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * Create all landscaper actions for the planner.
 */
export function createLandscaperActions(): BaseGOAPAction[] {
  return [
    // Trade actions (high priority when applicable)
    new CompleteTradeAction(),
    new RespondToTradeOfferAction(),
    new BroadcastTradeOfferAction(),

    // Regular actions
    new StudySpawnSignsAction(),
    new CheckFarmForTerraformNeedsAction(),
    new MaintainFarmsAction(),
    new PickupItemsAction(),
    new TerraformAreaAction(),
    new CraftShovelAction(),
    new CraftShovelFromPlanksAction(),
    new CraftPickaxeAction(),
    new CraftPickaxeFromPlanksAction(),
    new DepositItemsAction(),
    new CheckSharedChestAction(),
    new GatherDirtAction(),
    new CraftSlabsAction(),
    new ReadUnknownSignAction(),  // Curious bot - read unknown signs
    new ExploreAction(),
  ];
}
