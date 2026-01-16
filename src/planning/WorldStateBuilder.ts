import { WorldState } from './WorldState';
import type { FarmingBlackboard } from '../roles/farming/Blackboard';
import type { Bot } from 'mineflayer';

/**
 * Converts a FarmingBlackboard to a WorldState for GOAP planning.
 *
 * Facts are organized into categories:
 * - inv.*: Inventory state (seeds, produce, tools, materials)
 * - has.*: Boolean flags for equipment/capabilities
 * - nearby.*: Counts of nearby resources (crops, water, farmland, etc.)
 * - pos.*: Important positions (farmCenter, sharedChest, etc.)
 * - state.*: Bot state (lastAction, consecutiveIdleTicks, etc.)
 * - tree.*: Tree harvesting state
 */
export class WorldStateBuilder {
  /**
   * Build a WorldState from the current Blackboard.
   */
  static fromBlackboard(bot: Bot, bb: FarmingBlackboard): WorldState {
    const ws = new WorldState();

    // ═══════════════════════════════════════════════
    // INVENTORY FACTS
    // ═══════════════════════════════════════════════
    ws.set('inv.seeds', bb.seedCount);
    ws.set('inv.produce', bb.produceCount);
    ws.set('inv.logs', bb.logCount);
    ws.set('inv.planks', bb.plankCount);
    ws.set('inv.sticks', bb.stickCount);
    ws.set('inv.emptySlots', bb.emptySlots);

    // ═══════════════════════════════════════════════
    // EQUIPMENT / CAPABILITIES
    // ═══════════════════════════════════════════════
    ws.set('has.hoe', bb.hasHoe);
    ws.set('has.sword', bb.hasSword);
    ws.set('has.axe', this.hasAxe(bot));
    ws.set('has.craftingTable', this.hasCraftingTable(bot));

    // ═══════════════════════════════════════════════
    // NEARBY RESOURCES (counts for fast checking)
    // ═══════════════════════════════════════════════
    ws.set('nearby.water', bb.nearbyWater.length);
    ws.set('nearby.farmland', bb.nearbyFarmland.length);
    ws.set('nearby.matureCrops', bb.nearbyMatureCrops.length);
    ws.set('nearby.grass', bb.nearbyGrass.length);
    ws.set('nearby.drops', bb.nearbyDrops.length);
    ws.set('nearby.chests', bb.nearbyChests.length);
    ws.set('nearby.craftingTables', bb.nearbyCraftingTables.length);

    // ═══════════════════════════════════════════════
    // POSITIONS (POI - Points of Interest)
    // ═══════════════════════════════════════════════
    if (bb.farmCenter) {
      ws.set('pos.farmCenter', bb.farmCenter.clone());
    }
    if (bb.sharedChest) {
      ws.set('pos.sharedChest', bb.sharedChest.clone());
    }
    if (bb.sharedCraftingTable) {
      ws.set('pos.sharedCraftingTable', bb.sharedCraftingTable.clone());
    }
    ws.set('pos.bot', bot.entity.position.clone());

    // ═══════════════════════════════════════════════
    // STATE FLAGS
    // ═══════════════════════════════════════════════
    ws.set('state.inventoryFull', bb.inventoryFull);
    ws.set('state.lastAction', bb.lastAction);
    ws.set('state.consecutiveIdleTicks', bb.consecutiveIdleTicks);

    // ═══════════════════════════════════════════════
    // COMPUTED DECISIONS (from Blackboard)
    // ═══════════════════════════════════════════════
    ws.set('can.till', bb.canTill);
    ws.set('can.plant', bb.canPlant);
    ws.set('can.harvest', bb.canHarvest);
    ws.set('needs.tools', bb.needsTools);
    ws.set('needs.seeds', bb.needsSeeds);

    // ═══════════════════════════════════════════════
    // TREE HARVESTING STATE
    // ═══════════════════════════════════════════════
    if (bb.currentTreeHarvest) {
      ws.set('tree.active', true);
      ws.set('tree.phase', bb.currentTreeHarvest.phase);
      ws.set('tree.basePos', bb.currentTreeHarvest.basePos.clone());
      ws.set('tree.logType', bb.currentTreeHarvest.logType);
    } else {
      ws.set('tree.active', false);
    }

    // ═══════════════════════════════════════════════
    // DERIVED FACTS (for convenience in planning)
    // ═══════════════════════════════════════════════
    ws.set('derived.hasProduceToDeposit', bb.produceCount > 20 || bb.inventoryFull);
    ws.set('derived.canCraftHoe', this.canCraftHoe(bb));
    ws.set('derived.needsWood', bb.logCount === 0 && bb.plankCount < 4);
    ws.set('derived.hasFarmEstablished', bb.farmCenter !== null);
    ws.set('derived.hasStorageAccess', bb.sharedChest !== null || bb.nearbyChests.length > 0);

    return ws;
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
