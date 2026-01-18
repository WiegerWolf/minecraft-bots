import type { Bot } from 'mineflayer';
import { BaseGOAPAction, ActionResult, numericPrecondition, booleanPrecondition, incrementEffect, setEffect } from '../Action';
import { WorldState } from '../WorldState';
import type { FarmingBlackboard } from '../../roles/farming/Blackboard';
import { PickupItems } from '../../roles/farming/behaviors/actions/PickupItems';
import { HarvestCrops } from '../../roles/farming/behaviors/actions/HarvestCrops';
import { PlantSeeds } from '../../roles/farming/behaviors/actions/PlantSeeds';
import { TillGround } from '../../roles/farming/behaviors/actions/TillGround';
import { DepositItems } from '../../roles/farming/behaviors/actions/DepositItems';
import { GatherSeeds } from '../../roles/farming/behaviors/actions/GatherSeeds';
import { CraftHoe } from '../../roles/farming/behaviors/actions/CraftHoe';
import { Explore } from '../../roles/farming/behaviors/actions/Explore';
import { FindFarmCenter } from '../../roles/farming/behaviors/actions/FindFarmCenter';
import { CheckSharedChest } from '../../roles/farming/behaviors/actions/CheckSharedChest';
import { RequestMaterials } from '../../roles/farming/behaviors/actions/RequestMaterials';
import { StudySpawnSigns } from '../../roles/farming/behaviors/actions/StudySpawnSigns';
import { ReadUnknownSign } from '../../roles/farming/behaviors/actions/ReadUnknownSign';

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
    // Very low cost - picking up items is fast
    return 0.5;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Harvest mature crops
 */
export class HarvestCropsAction extends BaseGOAPAction {
  name = 'HarvestCrops';
  private impl = new HarvestCrops();

  preconditions = [
    numericPrecondition('nearby.matureCrops', v => v > 0, 'mature crops available'),
    booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
  ];

  effects = [
    incrementEffect('inv.produce', 10, 'harvested produce'),
    incrementEffect('inv.seeds', 5, 'got seeds from harvest'),
    setEffect('nearby.matureCrops', 0, 'crops harvested'),
  ];

  override getCost(ws: WorldState): number {
    // Low cost - harvesting is efficient
    return 1.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Plant seeds on farmland
 */
export class PlantSeedsAction extends BaseGOAPAction {
  name = 'PlantSeeds';
  private impl = new PlantSeeds();

  preconditions = [
    booleanPrecondition('has.hoe', true, 'has hoe'),
    numericPrecondition('inv.seeds', v => v > 0, 'has seeds'),
    numericPrecondition('nearby.farmland', v => v > 0, 'farmland available'),
  ];

  effects = [
    incrementEffect('inv.seeds', -5, 'seeds planted'),
    setEffect('nearby.farmland', 0, 'farmland planted'),
  ];

  override getCost(ws: WorldState): number {
    return 1.5;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Till ground near water to create farmland
 */
export class TillGroundAction extends BaseGOAPAction {
  name = 'TillGround';
  private impl = new TillGround();

  preconditions = [
    booleanPrecondition('has.hoe', true, 'has hoe'),
    numericPrecondition('nearby.water', v => v > 0, 'water nearby'),
    booleanPrecondition('derived.hasFarmEstablished', true, 'farm center established'),
  ];

  effects = [
    incrementEffect('nearby.farmland', 10, 'created farmland'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Deposit produce in chest
 */
export class DepositItemsAction extends BaseGOAPAction {
  name = 'DepositItems';
  private impl = new DepositItems();

  preconditions = [
    numericPrecondition('inv.produce', v => v > 0, 'has produce to deposit'),
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
  ];

  effects = [
    setEffect('inv.produce', 0, 'produce deposited'),
    setEffect('state.inventoryFull', false, 'inventory freed'),
  ];

  override getCost(ws: WorldState): number {
    // Cost depends on distance to chest
    return 2.5;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Gather seeds from grass
 * No preconditions - the action searches for grass up to 64 blocks away
 */
export class GatherSeedsAction extends BaseGOAPAction {
  name = 'GatherSeeds';
  private impl = new GatherSeeds();

  // No preconditions - action finds grass on its own up to 64 blocks away
  preconditions = [];

  effects = [
    incrementEffect('inv.seeds', 5, 'gathered seeds'),
    setEffect('needs.seeds', false, 'has enough seeds'),
  ];

  override getCost(ws: WorldState): number {
    // Lower cost if grass is visible nearby, higher if we need to search
    const grassCount = ws.getNumber('nearby.grass');
    return grassCount > 0 ? 2.0 : 4.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}


/**
 * GOAP Action: Craft a wooden hoe
 *
 * The implementation handles the full crafting chain internally:
 * logs → planks → sticks → hoe
 *
 * Precondition: Need materials (logs OR planks+sticks).
 * This allows the planner to chain: CheckSharedChest → CraftHoe
 */
export class CraftHoeAction extends BaseGOAPAction {
  name = 'CraftHoe';
  private impl = new CraftHoe();

  // Dynamic precondition: need logs OR (planks + sticks)
  preconditions = [];

  override checkPreconditions(ws: WorldState): boolean {
    const logs = ws.getNumber('inv.logs');
    const planks = ws.getNumber('inv.planks');
    const sticks = ws.getNumber('inv.sticks');

    // Can craft if we have: 2+ logs, OR 4+ planks (for sticks + head), OR (2+ planks AND 2+ sticks)
    return logs >= 2 || planks >= 4 || (planks >= 2 && sticks >= 2);
  }

  effects = [
    setEffect('has.hoe', true, 'crafted hoe'),
    setEffect('needs.tools', false, 'has tools'),
  ];

  override getCost(ws: WorldState): number {
    const logs = ws.getNumber('inv.logs');
    const planks = ws.getNumber('inv.planks');
    const sticks = ws.getNumber('inv.sticks');

    // Lower cost if we have more prepared materials
    if (planks >= 2 && sticks >= 2) return 2.0; // Ready to craft
    if (planks >= 4) return 3.0; // Need to make sticks
    if (logs >= 2) return 4.0; // Need to make planks + sticks
    return 10.0; // Can't craft
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    // CraftHoe returns 'running' for intermediate steps (planks, sticks, table)
    // These are still successful progress toward the goal
    if (result === 'success') return ActionResult.SUCCESS;
    if (result === 'running') return ActionResult.RUNNING;
    return ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Check shared chest for crafting materials (logs, planks, sticks)
 *
 * This action withdraws materials from the shared chest that the lumberjack deposits.
 */
export class CheckSharedChestAction extends BaseGOAPAction {
  name = 'CheckSharedChest';
  private impl = new CheckSharedChest();

  preconditions = [
    booleanPrecondition('needs.tools', true, 'needs tools'),
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
  ];

  effects = [
    incrementEffect('inv.logs', 4, 'withdrew logs from chest'),
  ];

  override getCost(ws: WorldState): number {
    return 2.0; // Low cost - just walking to chest
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Request materials from lumberjack via village chat
 *
 * This action requests logs from the lumberjack. It returns RUNNING to indicate
 * that we're waiting for materials to be deposited.
 */
export class RequestMaterialsAction extends BaseGOAPAction {
  name = 'RequestMaterials';
  private impl = new RequestMaterials();

  preconditions = [
    booleanPrecondition('needs.tools', true, 'needs tools'),
  ];

  effects = [
    // Requesting doesn't directly give us materials, but triggers lumberjack to deposit
    setEffect('state.materialsRequested', true, 'materials requested'),
  ];

  override getCost(ws: WorldState): number {
    return 5.0; // Medium cost - need to wait for lumberjack
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    // Running means we're waiting for materials
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}


/**
 * GOAP Action: Find and establish a farm center near water
 */
export class FindFarmCenterAction extends BaseGOAPAction {
  name = 'FindFarmCenter';
  private impl = new FindFarmCenter();

  preconditions = [
    booleanPrecondition('derived.hasFarmEstablished', false, 'no farm center yet'),
  ];

  effects = [
    setEffect('derived.hasFarmEstablished', true, 'farm center established'),
  ];

  override getCost(ws: WorldState): number {
    // Cost depends on whether we already see water
    const waterCount = ws.getNumber('nearby.water');
    if (waterCount > 0) return 1.0; // Water nearby, just need to establish
    return 5.0; // Need to search for water
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Explore to find resources
 */
export class ExploreAction extends BaseGOAPAction {
  name = 'Explore';
  private impl = new Explore();

  preconditions = [
    // Always applicable - fallback action
  ];

  effects = [
    // Exploration doesn't have predictable effects
    // But it reduces idle ticks
    setEffect('state.consecutiveIdleTicks', 0, 'explored'),
  ];

  override getCost(ws: WorldState): number {
    // High cost - exploration is expensive and unpredictable
    return 10.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Study signs at spawn to learn infrastructure locations
 * High priority on fresh spawn - bot walks to spawn and reads each sign.
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
    // Low cost - important startup action
    return 1.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Read unknown signs spotted while exploring
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
    // Medium cost - takes time to walk and read
    return 3.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * Create all farming actions for the planner.
 * Note: Wood gathering is handled by the lumberjack bot - farmer requests logs via chat.
 */
export function createFarmingActions(): BaseGOAPAction[] {
  return [
    new StudySpawnSignsAction(),  // High priority on spawn
    new PickupItemsAction(),
    new HarvestCropsAction(),
    new PlantSeedsAction(),
    new TillGroundAction(),
    new DepositItemsAction(),
    new GatherSeedsAction(),
    new CheckSharedChestAction(),
    new RequestMaterialsAction(),
    new CraftHoeAction(),
    new FindFarmCenterAction(),
    new ReadUnknownSignAction(),  // Curious bot - read unknown signs
    new ExploreAction(),
  ];
}
