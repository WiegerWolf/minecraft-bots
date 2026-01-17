import { WorldState } from './WorldState';
import type { FarmingBlackboard } from '../roles/farming/Blackboard';
import type { LumberjackBlackboard } from '../roles/lumberjack/LumberjackBlackboard';
import type { Bot } from 'mineflayer';

/**
 * Converts a Blackboard to a WorldState for GOAP planning.
 *
 * Supports both FarmingBlackboard and LumberjackBlackboard.
 *
 * Facts are organized into categories:
 * - inv.*: Inventory state (seeds, produce, tools, materials)
 * - has.*: Boolean flags for equipment/capabilities
 * - nearby.*: Counts of nearby resources (crops, water, farmland, etc.)
 * - pos.*: Important positions (farmCenter, sharedChest, etc.)
 * - state.*: Bot state (lastAction, consecutiveIdleTicks, etc.)
 * - tree.*: Tree harvesting state
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
   * Build a WorldState from the current Blackboard.
   */
  static fromBlackboard(bot: Bot, bb: FarmingBlackboard | LumberjackBlackboard): WorldState {
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

    // Tree harvesting state (used by both roles)
    if (bb.currentTreeHarvest) {
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
    if (this.isFarmingBlackboard(bb)) {
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
  }

  /**
   * Add lumberjack-specific facts to the world state.
   */
  private static addLumberjackFacts(bot: Bot, ws: WorldState, bb: LumberjackBlackboard): void {
    // Inventory
    ws.set('inv.saplings', bb.saplingCount);

    // Equipment
    ws.set('has.axe', bb.hasAxe);

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
    ws.set('derived.hasStorageAccess', bb.sharedChest !== null || bb.nearbyChests.length > 0);
    ws.set('derived.hasVillage', bb.villageCenter !== null);
    ws.set('derived.needsCraftingTable', bb.nearbyCraftingTables.length === 0 && !bb.sharedCraftingTable);
    ws.set('derived.needsChest', bb.nearbyChests.length === 0 && !bb.sharedChest);
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
