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
import { GatherWood } from '../../roles/farming/behaviors/actions/GatherWood';
import { CraftHoe } from '../../roles/farming/behaviors/actions/CraftHoe';
import { Explore } from '../../roles/farming/behaviors/actions/Explore';

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
 */
export class GatherSeedsAction extends BaseGOAPAction {
  name = 'GatherSeeds';
  private impl = new GatherSeeds();

  preconditions = [
    numericPrecondition('nearby.grass', v => v > 0, 'grass nearby'),
  ];

  effects = [
    incrementEffect('inv.seeds', 5, 'gathered seeds'),
    setEffect('needs.seeds', false, 'has enough seeds'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Gather wood from trees
 */
export class GatherWoodAction extends BaseGOAPAction {
  name = 'GatherWood';
  private impl = new GatherWood();

  preconditions = [
    // No specific preconditions - can always try to find trees
  ];

  effects = [
    incrementEffect('inv.logs', 4, 'chopped wood'),
    setEffect('derived.needsWood', false, 'has wood'),
  ];

  override getCost(ws: WorldState): number {
    // Higher cost - tree chopping takes time
    return 5.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Craft a wooden hoe
 */
export class CraftHoeAction extends BaseGOAPAction {
  name = 'CraftHoe';
  private impl = new CraftHoe();

  preconditions = [
    booleanPrecondition('derived.canCraftHoe', true, 'has materials for hoe'),
  ];

  effects = [
    setEffect('has.hoe', true, 'crafted hoe'),
    setEffect('needs.tools', false, 'has tools'),
    incrementEffect('inv.planks', -2, 'used planks'),
    incrementEffect('inv.sticks', -2, 'used sticks'),
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
 * Create all farming actions for the planner.
 */
export function createFarmingActions(): BaseGOAPAction[] {
  return [
    new PickupItemsAction(),
    new HarvestCropsAction(),
    new PlantSeedsAction(),
    new TillGroundAction(),
    new DepositItemsAction(),
    new GatherSeedsAction(),
    new GatherWoodAction(),
    new CraftHoeAction(),
    new ExploreAction(),
  ];
}
