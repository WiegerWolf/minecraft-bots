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
  RequestMaterials,
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

    // Debug logging
    console.log(`[TerraformAreaAction] Precondition check: pending=${hasPending}, shovel=${hasShovel}, pickaxe=${hasPickaxe}, anyTool=${hasAnyTool}`);

    if (!hasPending) {
      console.log('[TerraformAreaAction] FAILED: no pending terraform request');
      return false;
    }

    if (!hasShovel && !hasPickaxe && !hasAnyTool) {
      console.log('[TerraformAreaAction] FAILED: no tools');
      return false;
    }

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
    console.log(`[CraftShovelAction] Precondition check: hasShovel=${hasShovel}, inv.logs=${logs}`);
    if (hasShovel) {
      console.log('[CraftShovelAction] FAILED: already has shovel');
      return false;
    }
    if (logs < 2) {
      console.log('[CraftShovelAction] FAILED: not enough logs');
      return false;
    }
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
    console.log(`[CheckSharedChestAction] Precondition check: hasStorageAccess=${hasStorageAccess}, inv.logs=${logs}`);
    if (!hasStorageAccess) {
      console.log('[CheckSharedChestAction] FAILED: no storage access');
      return false;
    }
    if (logs >= 2) {
      console.log('[CheckSharedChestAction] FAILED: already has enough logs');
      return false;
    }
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
 * GOAP Action: Request materials from lumberjack
 *
 * This action just makes the request - it doesn't give logs directly.
 * After requesting, CheckSharedChest should be used to retrieve the logs
 * once the lumberjack deposits them.
 */
export class RequestMaterialsAction extends BaseGOAPAction {
  name = 'RequestMaterials';
  private impl = new RequestMaterials();

  preconditions = [
    // Need tools but don't have materials
    booleanPrecondition('needs.tools', true, 'needs tools'),
    numericPrecondition('inv.logs', v => v < 2, 'needs logs'),
    // Only request if we have chest access (where logs will be deposited)
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
  ];

  effects = [
    // Request was made - logs will arrive in chest (not inventory)
    // The actual logs come from CheckSharedChest action
    // This action's main purpose is to trigger the lumberjack to deposit logs
  ];

  override getCost(ws: WorldState): number {
    // Higher cost since this requires waiting for lumberjack
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
    new PickupItemsAction(),
    new TerraformAreaAction(),
    new CraftShovelAction(),
    new CraftShovelFromPlanksAction(),
    new CraftPickaxeAction(),
    new CraftPickaxeFromPlanksAction(),
    new DepositItemsAction(),
    new CheckSharedChestAction(),
    new ExploreAction(),
  ];
}
