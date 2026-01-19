import { WorldState } from '../../../src/planning/WorldState';
import { createWorldState } from './base';

/**
 * Preset: Lumberjack fresh spawn.
 */
export function freshSpawnLumberjackState(): WorldState {
  return createWorldState({
    'inv.logs': 0,
    'inv.planks': 0,
    'inv.sticks': 0,
    'inv.saplings': 0,
    'inv.emptySlots': 36,

    'has.axe': false,
    'has.sign': false,

    'nearby.reachableTrees': 0,
    'nearby.forestTrees': 0,      // Trees in actual forests (not structures)
    'nearby.drops': 0,
    'nearby.chests': 0,
    'nearby.craftingTables': 0,

    'state.inventoryFull': false,
    'state.consecutiveIdleTicks': 0,

    'derived.canCraftAxe': false,
    'derived.canCraftCraftingTable': false,
    'derived.canCraftChest': false,
    'derived.hasVillageCenter': false,
    'derived.hasStorageAccess': false,
    'derived.needsCraftingTable': true,   // Fresh spawn needs village center
    'derived.needsChest': true,            // Fresh spawn needs storage

    'has.incomingNeeds': false,
    'has.studiedSigns': false,
    'has.checkedStorage': false,
    'has.knownForest': false,         // Knows about a forest location

    'pending.hasForestSign': false,   // Has FOREST sign pending in queue

    'tree.active': false,
    'tree.phase': '',

    'trade.status': '',
    'trade.inTrade': false,
    'trade.tradeableCount': 0,
    'trade.pendingOffers': 0,
    'trade.onCooldown': false,

    // Exploration state
    'has.boat': false,
    'exploration.waterAhead': 0,
  });
}

/**
 * Preset: Lumberjack with axe and trees nearby.
 */
export function lumberjackReadyToChopState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.axe', true);
  ws.set('nearby.reachableTrees', 5);
  ws.set('nearby.forestTrees', 5);    // Trees in actual forest
  ws.set('has.studiedSigns', true);
  ws.set('has.knownForest', true);    // Knows about forest
  ws.set('derived.needsCraftingTable', false);  // Has village infrastructure
  ws.set('derived.needsChest', false);
  return ws;
}

/**
 * Preset: Lumberjack with lots of logs, needs to deposit.
 */
export function lumberjackNeedsToDepositState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('inv.logs', 48);
  ws.set('inv.emptySlots', 10);
  ws.set('derived.hasStorageAccess', true);
  ws.set('nearby.chests', 1);
  return ws;
}

/**
 * Preset: Lumberjack after studying signs, knows about storage.
 * Common state for many scenarios.
 */
export function lumberjackWithStorageKnowledgeState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.studiedSigns', true);
  ws.set('derived.hasStorageAccess', true);
  ws.set('nearby.chests', 1);
  return ws;
}

/**
 * Preset: Lumberjack mid-tree-harvest (started but not finished).
 */
export function lumberjackMidTreeHarvestState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('tree.active', true);
  ws.set('inv.logs', 4);
  return ws;
}

/**
 * Preset: Lumberjack with materials to craft axe (has enough logs).
 */
export function lumberjackCanCraftAxeState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.studiedSigns', true);
  ws.set('inv.logs', 3);
  ws.set('nearby.craftingTables', 1);
  ws.set('derived.canCraftAxe', true);
  return ws;
}

/**
 * Preset: Lumberjack with planks ready to craft axe.
 */
export function lumberjackCanCraftAxeFromPlanksState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.studiedSigns', true);
  ws.set('inv.planks', 9);
  ws.set('nearby.craftingTables', 1);
  ws.set('derived.canCraftAxe', true);
  return ws;
}

/**
 * Preset: Lumberjack with some materials but not enough for axe.
 */
export function lumberjackPartialMaterialsState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.studiedSigns', true);
  ws.set('inv.logs', 1);
  ws.set('inv.planks', 2);
  ws.set('nearby.reachableTrees', 3);
  return ws;
}

/**
 * Preset: Lumberjack with saplings to plant.
 */
export function lumberjackWithSaplingsState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('inv.saplings', 5);
  ws.set('inv.logs', 8);
  return ws;
}

/**
 * Preset: Lumberjack with pending farmer request.
 */
export function lumberjackWithFarmerRequestState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('has.incomingNeeds', true);
  ws.set('inv.logs', 8);
  ws.set('derived.hasStorageAccess', true);
  return ws;
}

/**
 * Preset: Lumberjack needing to craft infrastructure.
 */
export function lumberjackNeedsInfrastructureState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('inv.planks', 12);
  ws.set('derived.needsCraftingTable', true);
  ws.set('derived.needsChest', true);
  ws.set('nearby.craftingTables', 0);
  return ws;
}

/**
 * Preset: Lumberjack with pending sign writes.
 */
export function lumberjackWithPendingSignsState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('pending.signWrites', 2);
  ws.set('inv.planks', 8);
  ws.set('inv.sticks', 2);
  ws.set('has.sign', false);
  ws.set('derived.canCraftSign', true);
  return ws;
}

/**
 * Preset: Lumberjack in active trade.
 */
export function lumberjackInActiveTradeState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('trade.status', 'traveling');
  ws.set('trade.inTrade', true);
  return ws;
}

/**
 * Preset: Lumberjack with pending trade offers.
 */
export function lumberjackWithTradeOffersState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('trade.pendingOffers', 2);
  ws.set('trade.inTrade', false);
  ws.set('trade.status', '');
  return ws;
}

/**
 * Preset: Lumberjack with tradeable items (idle, can broadcast).
 */
export function lumberjackWithTradeableItemsState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('trade.tradeableCount', 8);
  ws.set('trade.inTrade', false);
  ws.set('trade.onCooldown', false);
  ws.set('trade.status', '');
  return ws;
}

/**
 * Preset: Lumberjack stuck (high idle ticks, trees reported but unreachable).
 */
export function lumberjackStuckState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('state.consecutiveIdleTicks', 10);
  ws.set('nearby.reachableTrees', 3); // Trees reported but bot keeps failing
  return ws;
}

/**
 * Preset: Lumberjack with unknown signs spotted.
 */
export function lumberjackWithUnknownSignsState(): WorldState {
  const ws = lumberjackReadyToChopState();
  ws.set('nearby.unknownSigns', 2);
  return ws;
}

/**
 * Preset: Lumberjack with village center but no storage yet.
 */
export function lumberjackNeedsStorageState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.studiedSigns', true);
  ws.set('has.axe', true);
  ws.set('inv.logs', 16);
  ws.set('inv.planks', 8);
  ws.set('derived.hasVillageCenter', true);
  ws.set('derived.needsChest', true);
  ws.set('derived.hasStorageAccess', false);
  return ws;
}
