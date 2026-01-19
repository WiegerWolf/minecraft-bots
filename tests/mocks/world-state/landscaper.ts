import { WorldState } from '../../../src/planning/WorldState';
import { createWorldState } from './base';

/**
 * Preset: Landscaper fresh spawn.
 */
export function freshSpawnLandscaperState(): WorldState {
  return createWorldState({
    'inv.dirt': 0,
    'inv.cobblestone': 0,
    'inv.slabs': 0,
    'inv.logs': 0,
    'inv.planks': 0,
    'inv.emptySlots': 36,

    'has.shovel': false,
    'has.pickaxe': false,

    'nearby.drops': 0,
    'nearby.dirt': 0,
    'nearby.water': 0,
    'nearby.chests': 0,
    'nearby.craftingTables': 0,

    'state.inventoryFull': false,
    'state.consecutiveIdleTicks': 0,

    'terraform.active': false,
    'has.pendingTerraformRequest': false,

    'derived.hasAnyTool': false,
    'derived.hasStorageAccess': false,

    'has.studiedSigns': false,
    'state.farmsNeedingCheck': 0,
    'state.farmsWithIssues': 0,
    'state.farmMaintenanceNeeded': false,

    'trade.status': '',
    'trade.inTrade': false,
    'trade.tradeableCount': 0,
    'trade.pendingOffers': 0,
    'trade.onCooldown': false,
  });
}

/**
 * Preset: Landscaper with tools, pending terraform request.
 */
export function landscaperWithTerraformRequestState(): WorldState {
  const ws = freshSpawnLandscaperState();
  ws.set('has.shovel', true);
  ws.set('has.pickaxe', true);
  ws.set('derived.hasAnyTool', true);
  ws.set('has.pendingTerraformRequest', true);
  ws.set('has.studiedSigns', true);
  return ws;
}

/**
 * Preset: Landscaper with both tools, ready to work.
 */
export function landscaperReadyToWorkState(): WorldState {
  const ws = freshSpawnLandscaperState();
  ws.set('has.studiedSigns', true);
  ws.set('has.shovel', true);
  ws.set('has.pickaxe', true);
  ws.set('derived.hasAnyTool', true);
  ws.set('inv.dirt', 32);
  return ws;
}

/**
 * Preset: Landscaper actively terraforming.
 */
export function landscaperActiveTerraformState(): WorldState {
  const ws = landscaperWithTerraformRequestState();
  ws.set('terraform.active', true);
  ws.set('inv.dirt', 64);
  return ws;
}

/**
 * Preset: Landscaper missing pickaxe (only has shovel).
 */
export function landscaperMissingShovelState(): WorldState {
  const ws = freshSpawnLandscaperState();
  ws.set('has.studiedSigns', true);
  ws.set('has.shovel', false);
  ws.set('has.pickaxe', true);
  ws.set('derived.hasAnyTool', true);
  ws.set('inv.planks', 4);
  return ws;
}

/**
 * Preset: Landscaper missing shovel (only has pickaxe).
 */
export function landscaperMissingPickaxeState(): WorldState {
  const ws = freshSpawnLandscaperState();
  ws.set('has.studiedSigns', true);
  ws.set('has.shovel', true);
  ws.set('has.pickaxe', false);
  ws.set('derived.hasAnyTool', true);
  ws.set('inv.planks', 8); // 8 planks = plankEquivalent 8 >= 7, gives ObtainTools utility 70
  return ws;
}

/**
 * Preset: Landscaper with materials to craft tools.
 */
export function landscaperWithMaterialsState(): WorldState {
  const ws = freshSpawnLandscaperState();
  ws.set('has.studiedSigns', true);
  ws.set('has.shovel', false);
  ws.set('has.pickaxe', false);
  ws.set('inv.logs', 3);
  ws.set('inv.planks', 8);
  return ws;
}

/**
 * Preset: Landscaper with farms needing check.
 */
export function landscaperWithFarmsToCheckState(): WorldState {
  const ws = landscaperReadyToWorkState();
  ws.set('state.farmsNeedingCheck', 3);
  return ws;
}

/**
 * Preset: Landscaper with farms needing maintenance.
 */
export function landscaperWithFarmMaintenanceState(): WorldState {
  const ws = landscaperReadyToWorkState();
  ws.set('state.farmsWithIssues', 2);
  ws.set('state.farmMaintenanceNeeded', true);
  ws.set('inv.dirt', 32);
  return ws;
}

/**
 * Preset: Landscaper with full inventory.
 */
export function landscaperFullInventoryState(): WorldState {
  const ws = landscaperReadyToWorkState();
  ws.set('state.inventoryFull', true);
  ws.set('inv.dirt', 128);
  ws.set('inv.cobblestone', 64);
  ws.set('derived.hasStorageAccess', true);
  return ws;
}

/**
 * Preset: Landscaper idle (nothing to do).
 */
export function landscaperIdleState(): WorldState {
  const ws = landscaperReadyToWorkState();
  ws.set('has.pendingTerraformRequest', false);
  ws.set('terraform.active', false);
  ws.set('state.farmsNeedingCheck', 0);
  ws.set('state.consecutiveIdleTicks', 10);
  return ws;
}

/**
 * Preset: Landscaper in active trade.
 */
export function landscaperInActiveTradeState(): WorldState {
  const ws = landscaperReadyToWorkState();
  ws.set('trade.status', 'traveling');
  ws.set('trade.inTrade', true);
  return ws;
}

/**
 * Preset: Landscaper with pending trade offers.
 */
export function landscaperWithTradeOffersState(): WorldState {
  const ws = landscaperReadyToWorkState();
  ws.set('trade.pendingOffers', 2);
  ws.set('trade.inTrade', false);
  ws.set('trade.status', '');
  return ws;
}

/**
 * Preset: Landscaper with tradeable items.
 */
export function landscaperWithTradeableItemsState(): WorldState {
  const ws = landscaperIdleState();
  ws.set('trade.tradeableCount', 8);
  ws.set('trade.inTrade', false);
  ws.set('trade.onCooldown', false);
  ws.set('trade.status', '');
  return ws;
}
