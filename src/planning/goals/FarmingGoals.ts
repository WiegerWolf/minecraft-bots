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
    numericGoalCondition('nearby.farmland', v => v > 20, 'sufficient farmland created', {
      value: 20,
      comparison: 'gte',
      estimatedDelta: 10, // ~10 farmland per tilling action
    }),
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
 * High priority when no tools available AND we can obtain materials.
 * Lower priority if we're waiting for lumberjack to deposit materials.
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

    // Check if we have materials to craft
    const logs = ws.getNumber('inv.logs');
    const planks = ws.getNumber('inv.planks');
    const sticks = ws.getNumber('inv.sticks');
    const hasStorage = ws.getBool('derived.hasStorageAccess');

    // Can craft now - VERY high priority
    if (logs >= 2 || planks >= 4 || (planks >= 2 && sticks >= 2)) {
      return 95;
    }

    // Have chest access - might be able to get materials
    if (hasStorage) {
      return 80;
    }

    // No materials and no chest - lower priority, let other goals run
    // (EstablishFarm, GatherSeeds, etc.)
    return 40;
  }
}

/**
 * Goal: Gather seeds from grass.
 * HIGH priority when waiting for hoe - farmer should gather seeds productively
 * rather than exploring aimlessly while waiting for lumberjack to deposit materials.
 */
export class GatherSeedsGoal extends BaseGoal {
  name = 'GatherSeeds';
  description = 'Break grass to collect seeds';

  conditions = [
    numericGoalCondition('inv.seeds', v => v >= 10, 'sufficient seeds', {
      value: 10,
      comparison: 'gte',
      estimatedDelta: 5, // ~5 seeds per grass break
    }),
  ];

  getUtility(ws: WorldState): number {
    const seedCount = ws.getNumber('inv.seeds');
    const hasHoe = ws.getBool('has.hoe');
    const hasFarm = ws.getBool('derived.hasFarmEstablished');

    // Already have enough seeds
    if (seedCount >= 10) return 0;

    // If we have a farm but no hoe, gathering seeds is the most productive activity
    // The action will search for grass up to 64 blocks away
    if (!hasHoe && hasFarm) {
      // Very high priority - better than exploring
      if (seedCount === 0) return 70;
      if (seedCount < 5) return 65;
      return 55;
    }

    // Normal priority when we have hoe or don't have farm yet
    if (seedCount === 0) return 55;
    if (seedCount < 5) return 45;
    return 30;
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
 * Goal: Read unknown signs spotted while exploring.
 * CURIOUS BOT behavior - when the bot sees a sign it hasn't read,
 * it will go investigate and potentially learn something useful.
 *
 * Lower priority than core farming work, but higher than explore.
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

    // Base utility of 45 - higher than explore (5-40) but lower than most farming work
    // Increases slightly with more signs to encourage batch reading
    return 45 + Math.min(unknownCount * 5, 15);
  }

  override isValid(ws: WorldState): boolean {
    return ws.getNumber('nearby.unknownSigns') > 0;
  }
}

/**
 * Goal: Write knowledge signs at spawn to share discoveries.
 * HIGH PRIORITY - sharing farm locations enables other farmers and landscapers.
 *
 * When the farmer establishes a farm center, it queues a FARM sign write.
 * This persists the knowledge for:
 * - Other farmers (can start farming at known locations)
 * - Landscapers (know where to terraform 9x9 farm areas)
 * - Future restarts (bots remember discovered resources)
 *
 * Priority is high (85-120) to ensure signs are written promptly after
 * establishing a farm, before getting distracted by routine farming tasks.
 */
export class WriteKnowledgeSignGoal extends BaseGoal {
  name = 'WriteKnowledgeSign';
  description = 'Write a knowledge sign at spawn';

  conditions = [
    numericGoalCondition('pending.signWrites', v => v === 0, 'no pending sign writes'),
  ];

  getUtility(ws: WorldState): number {
    const pendingCount = ws.getNumber('pending.signWrites');
    if (pendingCount === 0) return 0;

    // Check if we have materials or can get them
    const hasSign = ws.getBool('has.sign');
    const canCraftSign = ws.getBool('derived.canCraftSign');
    const hasStorage = ws.getBool('derived.hasStorageAccess');

    // VERY HIGH priority if we already have a sign ready - go write it now!
    if (hasSign) return 120;

    // HIGH priority if we can craft - do it soon
    if (canCraftSign) return 105;

    // MODERATE-HIGH priority if we can get materials from chest
    if (hasStorage) return 95;

    // MODERATE priority if we need to request materials from lumberjack
    return 85;
  }

  override isValid(ws: WorldState): boolean {
    return ws.getNumber('pending.signWrites') > 0;
  }
}

/**
 * Goal: Explore the world to find resources.
 * LOWEST PRIORITY - fallback when nothing else to do.
 *
 * This goal is satisfied when the bot is not idle (consecutiveIdleTicks == 0).
 * The explore action resets idle ticks, so completing exploration satisfies this goal.
 * This ensures Explore actually runs when selected, rather than returning an empty plan.
 */
export class ExploreGoal extends BaseGoal {
  name = 'Explore';
  description = 'Explore the world to find resources';

  conditions = [
    numericGoalCondition('state.consecutiveIdleTicks', v => v === 0, 'not idle', {
      value: 0,
      comparison: 'eq',
      estimatedDelta: -1, // Explore resets to 0
    }),
  ];

  getUtility(ws: WorldState): number {
    const idleTicks = ws.getNumber('state.consecutiveIdleTicks');

    // Low base utility, increases significantly if bot has been idle
    if (idleTicks > 5) {
      return 15 + Math.min(25, idleTicks / 2);
    }

    return 5;
  }

  // Explore is always valid
  override isValid(ws: WorldState): boolean {
    return true;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// TRADE GOALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Goal: Complete an active trade.
 * HIGHEST priority when in a trade - finish what we started.
 * This includes the 'offering' state where we're collecting WANT responses.
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
    const tradeStatus = ws.getString('trade.status');
    // Include 'offering' so we don't get preempted while collecting WANT responses
    const activeStatuses = ['offering', 'wanting', 'accepted', 'traveling', 'ready', 'dropping', 'picking_up'];

    if (!activeStatuses.includes(tradeStatus)) return 0;

    // Very high priority - finish what we started
    return 150;
  }

  override isValid(ws: WorldState): boolean {
    const tradeStatus = ws.getString('trade.status');
    const activeStatuses = ['offering', 'wanting', 'accepted', 'traveling', 'ready', 'dropping', 'picking_up'];
    return activeStatuses.includes(tradeStatus);
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
    const pendingOffers = ws.getNumber('trade.pendingOffers');
    const isInTrade = ws.getBool('trade.inTrade');
    const tradeStatus = ws.getString('trade.status');

    // Don't pursue if already responded/in trade or no offers
    if (pendingOffers === 0 || isInTrade) return 0;
    if (['wanting', 'accepted', 'traveling'].includes(tradeStatus)) return 0;

    // Medium-high priority - get items we want
    return 70;
  }

  override isValid(ws: WorldState): boolean {
    const pendingOffers = ws.getNumber('trade.pendingOffers');
    const isInTrade = ws.getBool('trade.inTrade');
    const tradeStatus = ws.getString('trade.status');
    return pendingOffers > 0 && !isInTrade && !['wanting', 'accepted', 'traveling'].includes(tradeStatus);
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
    const tradeableCount = ws.getNumber('trade.tradeableCount');
    const isInTrade = ws.getBool('trade.inTrade');
    const offerCooldown = ws.getBool('trade.onCooldown');
    const tradeStatus = ws.getString('trade.status');

    // HIGH priority if already offering - must finish collecting WANT responses
    if (tradeStatus === 'offering') {
      return 150;
    }

    // Don't pursue if in active trade or on cooldown
    if (isInTrade || offerCooldown) return 0;

    // Need 4+ tradeable items
    if (tradeableCount < 4) return 0;

    // Low priority - do when idle
    return 30 + Math.min(tradeableCount / 4, 5) * 4;
  }

  override isValid(ws: WorldState): boolean {
    const tradeableCount = ws.getNumber('trade.tradeableCount');
    const isInTrade = ws.getBool('trade.inTrade');
    const offerCooldown = ws.getBool('trade.onCooldown');
    const tradeStatus = ws.getString('trade.status');

    // Valid if offering (need to continue) OR if ready to start a new offer
    if (tradeStatus === 'offering') return true;
    return tradeableCount >= 4 && !isInTrade && !offerCooldown;
  }
}

/**
 * Registry of all farming goals.
 * Note: Wood gathering is handled by lumberjack bot - farmer requests logs via chat.
 */
export function createFarmingGoals(): BaseGoal[] {
  return [
    new CompleteTradeGoal(),      // Highest priority - finish active trades
    new StudySpawnSignsGoal(),    // Highest priority on spawn
    new CollectDropsGoal(),
    new RespondToTradeOfferGoal(),// Respond to trade offers
    new HarvestCropsGoal(),
    new DepositProduceGoal(),
    new PlantSeedsGoal(),
    new TillGroundGoal(),
    new ObtainToolsGoal(),
    new GatherSeedsGoal(),
    new EstablishFarmGoal(),
    new WriteKnowledgeSignGoal(), // Write farm/water signs to share knowledge
    new BroadcastTradeOfferGoal(),// Offer unwanted items when idle
    new ReadUnknownSignGoal(),    // Curious bot - read unknown signs
    new ExploreGoal(), // Always last - lowest priority fallback
  ];
}
