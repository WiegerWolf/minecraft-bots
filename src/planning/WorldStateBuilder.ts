import { WorldState } from './WorldState';
import type { FarmingBlackboard } from '../roles/farming/Blackboard';
import type { LumberjackBlackboard } from '../roles/lumberjack/LumberjackBlackboard';
import type { LandscaperBlackboard } from '../roles/landscaper/LandscaperBlackboard';
import type { Bot } from 'mineflayer';

/**
 * Converts a Blackboard to a WorldState for GOAP planning.
 *
 * Supports FarmingBlackboard, LumberjackBlackboard, and LandscaperBlackboard.
 *
 * Facts are organized into categories:
 * - inv.*: Inventory state (seeds, produce, tools, materials)
 * - has.*: Boolean flags for equipment/capabilities
 * - nearby.*: Counts of nearby resources (crops, water, farmland, etc.)
 * - pos.*: Important positions (farmCenter, sharedChest, etc.)
 * - state.*: Bot state (lastAction, consecutiveIdleTicks, etc.)
 * - tree.*: Tree harvesting state
 * - trade.*: Trade state (status, inTrade, tradeableCount, pendingOffers, onCooldown)
 * - can.*: Computed ability flags
 * - needs.*: Computed need flags
 * - derived.*: Derived convenience facts
 */
export class WorldStateBuilder {
  /**
   * Type guard to check if blackboard is a FarmingBlackboard.
   */
  private static isFarmingBlackboard(bb: any): bb is FarmingBlackboard {
    return 'hasHoe' in bb && 'seedCount' in bb;
  }

  /**
   * Type guard to check if blackboard is a LumberjackBlackboard.
   */
  private static isLumberjackBlackboard(bb: any): bb is LumberjackBlackboard {
    return 'hasAxe' in bb && 'nearbyTrees' in bb;
  }

  /**
   * Type guard to check if blackboard is a LandscaperBlackboard.
   */
  private static isLandscaperBlackboard(bb: any): bb is LandscaperBlackboard {
    return 'hasShovel' in bb && 'hasPickaxe' in bb && 'currentTerraformTask' in bb;
  }

  /**
   * Build a WorldState from the current Blackboard.
   */
  static fromBlackboard(bot: Bot, bb: FarmingBlackboard | LumberjackBlackboard | LandscaperBlackboard): WorldState {
    const ws = new WorldState();

    // ═══════════════════════════════════════════════
    // COMMON FACTS (shared between roles)
    // ═══════════════════════════════════════════════
    ws.set('inv.logs', bb.logCount);
    ws.set('inv.planks', bb.plankCount);
    ws.set('inv.sticks', bb.stickCount);
    ws.set('inv.emptySlots', bb.emptySlots);
    ws.set('state.inventoryFull', bb.inventoryFull);
    ws.set('state.lastAction', bb.lastAction);
    ws.set('state.consecutiveIdleTicks', bb.consecutiveIdleTicks);
    ws.set('nearby.drops', bb.nearbyDrops.length);
    ws.set('nearby.chests', bb.nearbyChests.length);
    ws.set('nearby.craftingTables', bb.nearbyCraftingTables.length);
    ws.set('has.craftingTable', this.hasCraftingTable(bot));
    ws.set('pos.bot', bot.entity.position.clone());

    // Shared positions
    if (bb.sharedChest) {
      ws.set('pos.sharedChest', bb.sharedChest.clone());
    }
    if (bb.sharedCraftingTable) {
      ws.set('pos.sharedCraftingTable', bb.sharedCraftingTable.clone());
    }

    // ═══════════════════════════════════════════════
    // TRADE STATE (shared between roles)
    // ═══════════════════════════════════════════════
    ws.set('trade.status', bb.activeTrade?.status ?? 'idle');
    ws.set('trade.inTrade', bb.activeTrade !== null);
    ws.set('trade.tradeableCount', bb.tradeableItemCount);
    ws.set('trade.pendingOffers', bb.pendingTradeOffers.length);
    // Don't mark as cooldown if we're actively offering - need to continue the action
    const tradeStatus = bb.activeTrade?.status ?? 'idle';
    const isActivelyOffering = tradeStatus === 'offering';
    ws.set('trade.onCooldown', !isActivelyOffering && Date.now() - bb.lastOfferTime < 30000);

    // Tree harvesting state (used by farming and lumberjack roles)
    if ('currentTreeHarvest' in bb && bb.currentTreeHarvest) {
      ws.set('tree.active', true);
      ws.set('tree.phase', bb.currentTreeHarvest.phase);
      ws.set('tree.basePos', bb.currentTreeHarvest.basePos.clone());
      ws.set('tree.logType', bb.currentTreeHarvest.logType);
    } else {
      ws.set('tree.active', false);
    }

    // ═══════════════════════════════════════════════
    // ROLE-SPECIFIC FACTS
    // ═══════════════════════════════════════════════
    if (this.isLandscaperBlackboard(bb)) {
      this.addLandscaperFacts(bot, ws, bb);
    } else if (this.isFarmingBlackboard(bb)) {
      this.addFarmingFacts(bot, ws, bb);
    } else if (this.isLumberjackBlackboard(bb)) {
      this.addLumberjackFacts(bot, ws, bb);
    }

    return ws;
  }

  /**
   * Add farming-specific facts to the world state.
   */
  private static addFarmingFacts(bot: Bot, ws: WorldState, bb: FarmingBlackboard): void {
    // Inventory
    ws.set('inv.seeds', bb.seedCount);
    ws.set('inv.produce', bb.produceCount);

    // Equipment
    ws.set('has.hoe', bb.hasHoe);
    ws.set('has.sword', bb.hasSword);
    ws.set('has.axe', this.hasAxe(bot));

    // Nearby resources
    ws.set('nearby.water', bb.nearbyWater.length);
    ws.set('nearby.farmland', bb.nearbyFarmland.length);
    ws.set('nearby.matureCrops', bb.nearbyMatureCrops.length);
    ws.set('nearby.grass', bb.nearbyGrass.length);

    // Positions
    if (bb.farmCenter) {
      ws.set('pos.farmCenter', bb.farmCenter.clone());
    }

    // Computed decisions
    ws.set('can.till', bb.canTill);
    ws.set('can.plant', bb.canPlant);
    ws.set('can.harvest', bb.canHarvest);
    ws.set('needs.tools', bb.needsTools);
    ws.set('needs.seeds', bb.needsSeeds);

    // Derived facts
    ws.set('derived.hasProduceToDeposit', bb.produceCount > 20 || bb.inventoryFull);
    ws.set('derived.canCraftHoe', this.canCraftHoe(bb));
    ws.set('derived.needsWood', bb.logCount === 0 && bb.plankCount < 4);
    ws.set('derived.hasFarmEstablished', bb.farmCenter !== null);
    ws.set('derived.hasStorageAccess', bb.sharedChest !== null || bb.nearbyChests.length > 0);

    // Sign-based persistent knowledge
    ws.set('has.studiedSigns', bb.hasStudiedSigns);
    ws.set('nearby.unknownSigns', bb.unknownSigns.length);
    ws.set('known.farms', bb.knownFarms.length);
    ws.set('known.waterSources', bb.knownWaterSources.length);

    // Sign writing
    ws.set('pending.signWrites', bb.pendingSignWrites.length);
    ws.set('has.sign', this.hasSign(bot));
    ws.set('derived.canCraftSign', this.canCraftSign(bb, bot));
  }

  /**
   * Add landscaper-specific facts to the world state.
   */
  private static addLandscaperFacts(bot: Bot, ws: WorldState, bb: LandscaperBlackboard): void {
    // Inventory
    ws.set('inv.dirt', bb.dirtCount);
    ws.set('inv.cobblestone', bb.cobblestoneCount);
    ws.set('inv.planks', bb.plankCount);
    ws.set('inv.slabs', bb.slabCount);

    // Equipment
    ws.set('has.shovel', bb.hasShovel);
    ws.set('has.pickaxe', bb.hasPickaxe);
    ws.set('derived.hasAnyTool', bb.hasShovel || bb.hasPickaxe);

    // Positions
    if (bb.villageCenter) {
      ws.set('pos.villageCenter', bb.villageCenter.clone());
    }

    // Terraform state
    ws.set('has.pendingTerraformRequest', bb.hasPendingTerraformRequest);
    ws.set('terraform.active', bb.currentTerraformTask !== null);
    if (bb.currentTerraformTask) {
      ws.set('terraform.phase', bb.currentTerraformTask.phase);
    }

    // Computed decisions
    ws.set('can.terraform', bb.canTerraform);
    ws.set('needs.tools', bb.needsTools);
    ws.set('needs.toDeposit', bb.needsToDeposit);

    // Derived facts
    ws.set('derived.hasStorageAccess', bb.sharedChest !== null || bb.nearbyChests.length > 0);
    ws.set('derived.hasVillage', bb.villageCenter !== null);
    ws.set('derived.canCraftShovel', this.canCraftShovel(bb));
    ws.set('derived.canCraftPickaxe', this.canCraftPickaxe(bb));

    // Sign-based farm knowledge (proactive terraforming)
    ws.set('has.studiedSigns', bb.hasStudiedSigns);
    ws.set('known.farms', bb.knownFarms.length);
    ws.set('state.knownFarmCount', bb.knownFarms.length);
    ws.set('state.farmsNeedingCheck', bb.farmsNeedingCheck.length);

    // Farm maintenance state
    // Maintenance is needed if any farm hasn't been checked in 5 minutes
    const now = Date.now();
    const maintenanceInterval = 5 * 60 * 1000; // 5 minutes
    const farmMaintenanceNeeded = bb.knownFarms.some(farmPos => {
      const key = `${Math.floor(farmPos.x)},${Math.floor(farmPos.y)},${Math.floor(farmPos.z)}`;
      const lastCheck = bb.lastFarmCheckTimes.get(key) || 0;
      return (now - lastCheck) > maintenanceInterval;
    });
    ws.set('state.farmMaintenanceNeeded', farmMaintenanceNeeded);
  }

  /**
   * Add lumberjack-specific facts to the world state.
   */
  private static addLumberjackFacts(bot: Bot, ws: WorldState, bb: LumberjackBlackboard): void {
    // Inventory
    ws.set('inv.saplings', bb.saplingCount);

    // Equipment
    ws.set('has.axe', bb.hasAxe);
    ws.set('has.sign', this.hasSign(bot));

    // Nearby resources
    ws.set('nearby.trees', bb.nearbyTrees.length);
    // Reachable trees = trees at or below bot level (already filtered in blackboard)
    // This distinguishes from trees we can see but are standing on top of
    ws.set('nearby.reachableTrees', bb.nearbyTrees.length);
    ws.set('nearby.logs', bb.nearbyLogs.length);
    ws.set('nearby.leaves', bb.nearbyLeaves.length);

    // Positions
    if (bb.villageCenter) {
      ws.set('pos.villageCenter', bb.villageCenter.clone());
    }

    // Computed decisions
    ws.set('can.chop', bb.canChop);
    ws.set('needs.toDeposit', bb.needsToDeposit);
    ws.set('has.pendingRequests', bb.hasPendingRequests);

    // Derived facts
    ws.set('derived.canCraftAxe', this.canCraftAxe(bb));
    ws.set('derived.canCraftSign', this.canCraftSign(bb));
    ws.set('derived.hasStorageAccess', this.hasAvailableStorage(bb));
    ws.set('derived.hasVillage', bb.villageCenter !== null);
    ws.set('derived.needsCraftingTable', bb.nearbyCraftingTables.length === 0 && !bb.sharedCraftingTable);
    ws.set('derived.needsChest', bb.nearbyChests.length === 0 && !bb.sharedChest);

    // Sign-based persistent knowledge
    ws.set('pending.signWrites', bb.pendingSignWrites.length);

    // Startup behaviors (one-time on spawn)
    ws.set('has.studiedSigns', bb.hasStudiedSigns);
    ws.set('has.checkedStorage', bb.hasCheckedStorage);

    // Curious bot - sign discovery
    ws.set('nearby.unknownSigns', bb.unknownSigns.length);
    ws.set('known.chests', bb.knownChests.length);
    ws.set('known.forests', bb.knownForests.length);
  }

  /**
   * Check if bot has an axe in inventory.
   */
  private static hasAxe(bot: Bot): boolean {
    return bot.inventory.items().some(i => i.name.includes('axe'));
  }

  /**
   * Check if bot has a crafting table in inventory.
   */
  private static hasCraftingTable(bot: Bot): boolean {
    return bot.inventory.items().some(i => i.name === 'crafting_table');
  }

  /**
   * Check if bot can craft a wooden hoe (has materials).
   */
  private static canCraftHoe(bb: FarmingBlackboard): boolean {
    // Need 2 planks and 2 sticks (or enough planks to make sticks)
    const hasPlanks = bb.plankCount >= 2;
    const hasSticks = bb.stickCount >= 2;
    const canMakeSticks = bb.plankCount >= 4; // 2 planks for sticks + 2 for hoe head
    return hasPlanks && (hasSticks || canMakeSticks);
  }

  /**
   * Check if bot can craft a wooden axe (has materials).
   */
  private static canCraftAxe(bb: LumberjackBlackboard): boolean {
    // Need 3 planks and 2 sticks (or enough planks to make sticks)
    const hasPlanks = bb.plankCount >= 3;
    const hasSticks = bb.stickCount >= 2;
    const canMakeSticks = bb.plankCount >= 5; // 2 planks for sticks + 3 for axe head
    return hasPlanks && (hasSticks || canMakeSticks);
  }

  /**
   * Check if bot can craft a wooden shovel (has materials).
   */
  private static canCraftShovel(bb: LandscaperBlackboard): boolean {
    // Need 1 plank and 2 sticks (or enough planks to make sticks)
    const hasPlanks = bb.plankCount >= 1;
    const hasSticks = bb.stickCount >= 2;
    const canMakeSticks = bb.plankCount >= 3; // 2 planks for sticks + 1 for shovel head
    return hasPlanks && (hasSticks || canMakeSticks);
  }

  /**
   * Check if bot can craft a wooden pickaxe (has materials).
   */
  private static canCraftPickaxe(bb: LandscaperBlackboard): boolean {
    // Need 3 planks and 2 sticks (or enough planks to make sticks)
    const hasPlanks = bb.plankCount >= 3;
    const hasSticks = bb.stickCount >= 2;
    const canMakeSticks = bb.plankCount >= 5; // 2 planks for sticks + 3 for pickaxe head
    return hasPlanks && (hasSticks || canMakeSticks);
  }

  /**
   * Check if bot has a sign in inventory.
   */
  private static hasSign(bot: Bot): boolean {
    return bot.inventory.items().some(i => i.name.includes('_sign'));
  }

  /**
   * Check if bot can craft a sign (has materials).
   * Sign recipe: 6 planks + 1 stick = 3 signs (requires crafting table)
   */
  private static canCraftSign(bb: LumberjackBlackboard | FarmingBlackboard, bot?: Bot): boolean {
    const hasPlanks = bb.plankCount >= 6;
    const hasSticks = bb.stickCount >= 1;
    const hasCraftingTable = bb.nearbyCraftingTables.length > 0 || bb.sharedCraftingTable !== null;
    return hasPlanks && hasSticks && hasCraftingTable;
  }

  /**
   * Check if lumberjack has any available (non-full) storage.
   * Returns false if all known chests are marked as full.
   */
  private static hasAvailableStorage(bb: LumberjackBlackboard): boolean {
    const posToKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;

    const now = Date.now();

    // Check shared chest
    if (bb.sharedChest) {
      const key = posToKey(bb.sharedChest);
      const expiry = bb.fullChests.get(key);
      if (!expiry || now >= expiry) {
        return true; // Shared chest is available
      }
    }

    // Check nearby chests
    for (const chest of bb.nearbyChests) {
      const key = posToKey(chest.position);
      const expiry = bb.fullChests.get(key);
      if (!expiry || now >= expiry) {
        return true; // This chest is available
      }
    }

    return false; // All chests are full
  }

  /**
   * Calculate the difference between two world states.
   * Used by the planner to detect significant changes that require replanning.
   */
  static calculateSignificantChanges(oldState: WorldState, newState: WorldState): number {
    // Define which facts are "significant" for replanning
    const significantFacts = [
      'has.hoe',
      'has.sword',
      'has.axe',
      'nearby.matureCrops',
      'nearby.drops',
      'state.inventoryFull',
      'pos.farmCenter',
      'tree.active',
      'derived.hasFarmEstablished',
      // Trade-related facts
      'trade.inTrade',
      'trade.status',
      'trade.pendingOffers',
    ];

    let changes = 0;
    for (const fact of significantFacts) {
      const oldVal = oldState.get(fact);
      const newVal = newState.get(fact);

      // Count numeric changes greater than threshold
      if (typeof oldVal === 'number' && typeof newVal === 'number') {
        const diff = Math.abs(newVal - oldVal);
        if (diff > 5) { // Threshold for significant change
          changes++;
        }
      }
      // Count any boolean/position changes
      else if (oldVal !== newVal) {
        changes++;
      }
    }

    return changes;
  }
}
