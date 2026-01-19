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
import { BroadcastNeed } from '../../roles/farming/behaviors/actions/BroadcastNeed';
import { StudySpawnSigns } from '../../roles/farming/behaviors/actions/StudySpawnSigns';
import { ReadUnknownSign } from '../../roles/farming/behaviors/actions/ReadUnknownSign';
import { WriteKnowledgeSign } from '../../roles/farming/behaviors/actions/WriteKnowledgeSign';
import { BroadcastOffer, RespondToOffer, CompleteTrade } from '../../roles/farming/behaviors/actions/TradeActions';
import { FollowLumberjack } from '../../roles/farming/behaviors/actions/FollowLumberjack';

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
 * If the chest is empty, it requests materials from the lumberjack and returns RUNNING
 * to keep the goal active while waiting.
 */
export class CheckSharedChestAction extends BaseGOAPAction {
  name = 'CheckSharedChest';
  private impl = new CheckSharedChest();

  preconditions = [
    booleanPrecondition('needs.tools', true, 'needs tools'),
  ];

  effects = [
    incrementEffect('inv.logs', 4, 'withdrew logs from chest'),
  ];

  override getCost(ws: WorldState): number {
    // Lower cost if we have chest access
    const hasStorage = ws.getBool('derived.hasStorageAccess');
    return hasStorage ? 2.0 : 3.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'success') return ActionResult.SUCCESS;
    if (result === 'running') return ActionResult.RUNNING;  // Waiting for lumberjack
    return ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Broadcast need for tools via the intent-based need system
 *
 * This action broadcasts a need for a hoe. Other bots can offer to provide
 * the item directly, crafting materials, or raw materials. Returns RUNNING
 * while waiting for offers and delivery.
 */
export class BroadcastNeedAction extends BaseGOAPAction {
  name = 'BroadcastNeed';
  private impl = new BroadcastNeed();

  preconditions = [
    booleanPrecondition('needs.tools', true, 'needs tools'),
  ];

  effects = [
    // Broadcasting a need starts the process of getting tools
    setEffect('state.needBroadcast', true, 'need broadcast'),
  ];

  override getCost(ws: WorldState): number {
    return 5.0; // Medium cost - need to wait for provider
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    // Running means we're waiting for offers/delivery
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
 * GOAP Action: Follow lumberjack during exploration phase.
 *
 * When there's no village center, the farmer should stay near the lumberjack
 * to hear village chat messages about the village center location.
 */
export class FollowLumberjackAction extends BaseGOAPAction {
  name = 'FollowLumberjack';
  private impl = new FollowLumberjack();

  preconditions = [
    booleanPrecondition('has.studiedSigns', true, 'has studied signs'),
    booleanPrecondition('derived.hasVillage', false, 'no village center yet'),
    booleanPrecondition('nearby.hasLumberjack', true, 'lumberjack visible'),
    numericPrecondition('nearby.lumberjackDistance', v => v > 30, 'too far from lumberjack'),
  ];

  effects = [
    // After following, we should be close enough
    setEffect('nearby.lumberjackDistance', 20, 'near lumberjack'),
  ];

  override getCost(ws: WorldState): number {
    // Medium cost - following takes time but is important
    const distance = ws.getNumber('nearby.lumberjackDistance');
    // Cost scales with distance
    return 3.0 + Math.min(distance / 50, 5.0);
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
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
 * GOAP Action: Get materials needed for sign crafting
 *
 * This action withdraws planks and sticks from the shared chest specifically
 * for crafting signs. It enables the planner to chain:
 * GetSignMaterials → WriteKnowledgeSign
 *
 * This is separate from CheckSharedChest (which is for tools) because:
 * - Sign writing has CRITICAL priority for FARM signs
 * - We need to get materials even if we already have a hoe
 */
export class GetSignMaterialsAction extends BaseGOAPAction {
  name = 'GetSignMaterials';
  private impl = new CheckSharedChest(); // Reuse existing chest logic

  preconditions = [
    numericPrecondition('pending.signWrites', v => v > 0, 'has pending sign writes'),
    booleanPrecondition('has.sign', false, 'does not have sign'),
    booleanPrecondition('derived.canCraftSign', false, 'cannot craft sign yet'),
    booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
  ];

  effects = [
    // After getting materials, we should be able to craft
    incrementEffect('inv.planks', 6, 'withdrew planks for sign'),
    incrementEffect('inv.sticks', 2, 'withdrew sticks for sign'),
    setEffect('derived.canCraftSign', true, 'can now craft sign'),
  ];

  override getCost(ws: WorldState): number {
    // Low cost - getting materials is quick if chest has them
    return 2.0;
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    // Broadcast need for sign materials if needed
    if (bb.villageChat) {
      const plankCount = bot.inventory.items()
        .filter(i => i.name.endsWith('_planks'))
        .reduce((sum, i) => sum + i.count, 0);
      const stickCount = bot.inventory.items()
        .filter(i => i.name === 'stick')
        .reduce((sum, i) => sum + i.count, 0);

      if (plankCount < 6 && !bb.villageChat.hasPendingNeedFor('planks')) {
        bb.log?.info('Broadcasting need for planks for sign');
        bb.villageChat.broadcastNeed('planks');
      }
      if (stickCount < 1 && !bb.villageChat.hasPendingNeedFor('stick')) {
        bb.log?.info('Broadcasting need for sticks for sign');
        bb.villageChat.broadcastNeed('stick');
      }
    }

    // Use CheckSharedChest to withdraw materials
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING; // Waiting for materials
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * GOAP Action: Write knowledge signs at spawn
 * Writes FARM/WATER signs to share discoveries with other bots.
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
   * For planner chaining, we also accept raw material checks:
   * - inv.planks >= 6 AND inv.sticks >= 1 (with implicit crafting table)
   */
  override checkPreconditions(ws: WorldState): boolean {
    const pendingWrites = ws.getNumber('pending.signWrites');
    if (pendingWrites <= 0) return false;

    // Already have a sign - can write immediately
    const hasSign = ws.getBool('has.sign');
    if (hasSign) return true;

    // Can craft a sign (has materials + crafting table)
    const canCraft = ws.getBool('derived.canCraftSign');
    if (canCraft) return true;

    // For planner chaining: check raw materials (ProcessWood could satisfy this)
    const planks = ws.getNumber('inv.planks');
    const sticks = ws.getNumber('inv.sticks');
    const hasCraftingTable = ws.getNumber('nearby.craftingTables') > 0 ||
                             ws.get('pos.sharedCraftingTable') !== undefined;

    return planks >= 6 && sticks >= 1 && hasCraftingTable;
  }

  override getCost(ws: WorldState): number {
    const hasSign = ws.getBool('has.sign');
    if (hasSign) return 2.0; // Just need to walk and place

    const canCraft = ws.getBool('derived.canCraftSign');
    if (canCraft) return 4.0; // Need to craft first

    return 8.0; // Need to get materials from somewhere
  }

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
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

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
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

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
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

  override async execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult> {
    const result = await this.impl.tick(bot, bb);
    if (result === 'running') return ActionResult.RUNNING;
    return result === 'success' ? ActionResult.SUCCESS : ActionResult.FAILURE;
  }
}

/**
 * Create all farming actions for the planner.
 * Note: Wood gathering is handled by the lumberjack bot - farmer requests logs via chat.
 */
export function createFarmingActions(): BaseGOAPAction[] {
  return [
    // Trade actions (high priority when applicable)
    new CompleteTradeAction(),
    new RespondToTradeOfferAction(),
    new BroadcastTradeOfferAction(),

    // Regular actions
    new StudySpawnSignsAction(),  // High priority on spawn
    new PickupItemsAction(),
    new HarvestCropsAction(),
    new PlantSeedsAction(),
    new TillGroundAction(),
    new DepositItemsAction(),
    new GatherSeedsAction(),
    new CheckSharedChestAction(),
    new BroadcastNeedAction(),
    new CraftHoeAction(),
    new FindFarmCenterAction(),
    new GetSignMaterialsAction(),    // Get materials for sign crafting
    new WriteKnowledgeSignAction(),  // Write farm/water signs
    new ReadUnknownSignAction(),  // Curious bot - read unknown signs
    new FollowLumberjackAction(),    // Follow lumberjack during exploration
    new ExploreAction(),
  ];
}
