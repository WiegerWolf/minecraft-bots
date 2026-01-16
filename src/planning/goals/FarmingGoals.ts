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
 * Goal: Harvest mature crops.
 * High priority when crops are ready.
 */
export class HarvestCropsGoal extends BaseGoal {
  name = 'HarvestCrops';
  description = 'Harvest mature crops';

  conditions = [
    numericGoalCondition('nearby.matureCrops', v => v === 0, 'no mature crops'),
  ];

  getUtility(ws: WorldState): number {
    const cropCount = ws.getNumber('nearby.matureCrops');
    const inventoryFull = ws.getBool('state.inventoryFull');

    if (cropCount === 0 || inventoryFull) return 0;

    // Scale utility with number of mature crops
    return Math.min(100, 60 + cropCount * 3);
  }
}

/**
 * Goal: Deposit produce in storage to free up inventory.
 * High priority when inventory is full or has lots of produce.
 */
export class DepositProduceGoal extends BaseGoal {
  name = 'DepositProduce';
  description = 'Deposit harvested produce in chest';

  conditions = [
    numericGoalCondition('inv.produce', v => v < 5, 'little produce remaining'),
  ];

  getUtility(ws: WorldState): number {
    const produceCount = ws.getNumber('inv.produce');
    const inventoryFull = ws.getBool('state.inventoryFull');
    const hasStorage = ws.getBool('derived.hasStorageAccess');

    if (produceCount === 0 || !hasStorage) return 0;

    // Very high priority when inventory full
    if (inventoryFull) return 90;

    // Scale with produce count
    if (produceCount > 32) return 70;
    if (produceCount > 16) return 40;
    return 20;
  }
}

/**
 * Goal: Plant seeds on available farmland.
 * Moderate priority, depends on available farmland.
 */
export class PlantSeedsGoal extends BaseGoal {
  name = 'PlantSeeds';
  description = 'Plant seeds on tilled farmland';

  conditions = [
    numericGoalCondition('nearby.farmland', v => v === 0, 'no empty farmland'),
  ];

  getUtility(ws: WorldState): number {
    const canPlant = ws.getBool('can.plant');
    const emptyFarmland = ws.getNumber('nearby.farmland');

    if (!canPlant || emptyFarmland === 0) return 0;

    // More empty farmland = higher utility
    return Math.min(60, 30 + emptyFarmland * 2);
  }
}

/**
 * Goal: Till ground near water to create farmland.
 * Moderate priority, needed to expand farm.
 */
export class TillGroundGoal extends BaseGoal {
  name = 'TillGround';
  description = 'Till ground near water to create farmland';

  conditions = [
    numericGoalCondition('nearby.farmland', v => v > 20, 'sufficient farmland created'),
  ];

  getUtility(ws: WorldState): number {
    const canTill = ws.getBool('can.till');
    const farmlandCount = ws.getNumber('nearby.farmland');
    const hasFarm = ws.getBool('derived.hasFarmEstablished');

    if (!canTill || !hasFarm) return 0;

    // Higher utility when we have little farmland
    if (farmlandCount < 10) return 50;
    if (farmlandCount < 20) return 30;
    return 10;
  }
}

/**
 * Goal: Obtain farming tools (hoe).
 * High priority when no tools available.
 */
export class ObtainToolsGoal extends BaseGoal {
  name = 'ObtainTools';
  description = 'Craft or find a hoe for farming';

  conditions = [
    booleanGoalCondition('has.hoe', true, 'has hoe'),
  ];

  getUtility(ws: WorldState): number {
    const hasHoe = ws.getBool('has.hoe');

    if (hasHoe) return 0;

    // Very high priority - can't farm without tools
    return 80;
  }
}

/**
 * Goal: Gather seeds from grass.
 * Moderate priority when low on seeds.
 */
export class GatherSeedsGoal extends BaseGoal {
  name = 'GatherSeeds';
  description = 'Break grass to collect seeds';

  conditions = [
    numericGoalCondition('inv.seeds', v => v >= 10, 'sufficient seeds'),
  ];

  getUtility(ws: WorldState): number {
    const needsSeeds = ws.getBool('needs.seeds');
    const grassCount = ws.getNumber('nearby.grass');
    const seedCount = ws.getNumber('inv.seeds');

    if (!needsSeeds || grassCount === 0) return 0;

    // Higher utility when we have fewer seeds
    if (seedCount === 0) return 55;
    if (seedCount < 5) return 45;
    return 30;
  }
}

/**
 * Goal: Gather wood for crafting tools.
 * High priority when no wood and need to craft hoe.
 */
export class GatherWoodGoal extends BaseGoal {
  name = 'GatherWood';
  description = 'Chop trees to collect wood';

  conditions = [
    numericGoalCondition('inv.logs', v => v >= 4, 'sufficient wood'),
  ];

  getUtility(ws: WorldState): number {
    const needsWood = ws.getBool('derived.needsWood');
    const hasHoe = ws.getBool('has.hoe');

    if (!needsWood) return 0;

    // Higher priority if we don't have a hoe yet
    if (!hasHoe) return 70;
    return 40;
  }
}

/**
 * Goal: Establish a farm near water.
 * High priority at game start, low once farm is established.
 */
export class EstablishFarmGoal extends BaseGoal {
  name = 'EstablishFarm';
  description = 'Find water and establish farm center';

  conditions = [
    booleanGoalCondition('derived.hasFarmEstablished', true, 'farm established'),
  ];

  getUtility(ws: WorldState): number {
    const hasFarm = ws.getBool('derived.hasFarmEstablished');
    const waterCount = ws.getNumber('nearby.water');

    if (hasFarm) return 0;

    // Very high priority if we have no farm yet
    if (waterCount > 0) return 75; // Water found, just need to set center
    return 65; // Need to find water
  }
}

/**
 * Goal: Explore the world to find resources.
 * LOWEST PRIORITY - fallback when nothing else to do.
 */
export class ExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Explore the world to find resources';

  conditions = [
    // This goal is never "satisfied" - always available as fallback
  ];

  getUtility(ws: WorldState): number {
    const idleTicks = ws.getNumber('state.consecutiveIdleTicks');

    // Low base utility, increases if bot has been idle
    return 5 + Math.min(20, idleTicks / 10);
  }

  // Explore is always valid
  override isValid(ws: WorldState): boolean {
    return true;
  }
}

/**
 * Goal: Continue an in-progress tree harvest.
 * High priority to complete started work.
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
 * Registry of all farming goals.
 */
export function createFarmingGoals(): BaseGoal[] {
  return [
    new CollectDropsGoal(),
    new HarvestCropsGoal(),
    new DepositProduceGoal(),
    new PlantSeedsGoal(),
    new TillGroundGoal(),
    new ObtainToolsGoal(),
    new GatherSeedsGoal(),
    new GatherWoodGoal(),
    new EstablishFarmGoal(),
    new CompleteTreeHarvestGoal(),
    new ExploreGoal(), // Always last - lowest priority fallback
  ];
}
