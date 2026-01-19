import { WorldState } from '../../../src/planning/WorldState';
import { createWorldState } from './base';

/**
 * Preset: Farmer with no tools, no seeds, no farm.
 * The "fresh spawn" state.
 */
export function freshSpawnFarmerState(): WorldState {
  return createWorldState({
    // Inventory
    'inv.seeds': 0,
    'inv.produce': 0,
    'inv.logs': 0,
    'inv.planks': 0,
    'inv.sticks': 0,
    'inv.emptySlots': 36,

    // Tools
    'has.hoe': false,
    'has.sword': false,
    'has.axe': false,
    'has.sign': false,

    // Perception
    'nearby.water': 0,
    'nearby.farmland': 0,
    'nearby.matureCrops': 0,
    'nearby.grass': 0,
    'nearby.drops': 0,
    'nearby.chests': 0,
    'nearby.craftingTables': 0,
    'nearby.unknownSigns': 0,

    // State flags
    'state.inventoryFull': false,
    'state.consecutiveIdleTicks': 0,

    // Derived facts
    'derived.hasFarmEstablished': false,
    'derived.hasStorageAccess': false,
    'derived.canCraftHoe': false,
    'derived.canCraftSign': false,
    'derived.needsWood': true,

    // Can-do flags
    'can.till': false,
    'can.plant': false,
    'can.harvest': false,
    'needs.tools': true,
    'needs.seeds': true,

    // Sign state
    'has.studiedSigns': false,
    'pending.signWrites': 0,
    'pending.hasFarmSign': false,

    // Trade state
    'trade.status': '',
    'trade.inTrade': false,
    'trade.tradeableCount': 0,
    'trade.pendingOffers': 0,
    'trade.onCooldown': false,

    // Tree harvest state
    'tree.active': false,
  });
}

/**
 * Preset: Farmer with established farm, hoe, seeds ready to work.
 */
export function establishedFarmerState(): WorldState {
  return createWorldState({
    // Inventory
    'inv.seeds': 20,
    'inv.produce': 0,
    'inv.logs': 0,
    'inv.planks': 0,
    'inv.sticks': 0,
    'inv.emptySlots': 30,

    // Tools
    'has.hoe': true,
    'has.sword': false,
    'has.axe': false,
    'has.sign': false,

    // Perception - farm area
    'nearby.water': 1,
    'nearby.farmland': 15,
    'nearby.matureCrops': 0,
    'nearby.grass': 5,
    'nearby.drops': 0,
    'nearby.chests': 1,
    'nearby.craftingTables': 1,
    'nearby.unknownSigns': 0,

    // State
    'state.inventoryFull': false,
    'state.consecutiveIdleTicks': 0,

    // Derived
    'derived.hasFarmEstablished': true,
    'derived.hasStorageAccess': true,
    'derived.canCraftHoe': false,
    'derived.canCraftSign': false,
    'derived.needsWood': false,

    // Can-do
    'can.till': true,
    'can.plant': true,
    'can.harvest': false,
    'needs.tools': false,
    'needs.seeds': false,

    // Signs
    'has.studiedSigns': true,
    'pending.signWrites': 0,
    'pending.hasFarmSign': false,

    // Trade
    'trade.status': '',
    'trade.inTrade': false,
    'trade.tradeableCount': 0,
    'trade.pendingOffers': 0,
    'trade.onCooldown': false,

    // Tree
    'tree.active': false,
  });
}

/**
 * Preset: Farmer with mature crops ready to harvest.
 */
export function farmerWithMatureCropsState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('nearby.matureCrops', 12);
  ws.set('can.harvest', true);
  return ws;
}

/**
 * Preset: Farmer with drops nearby (high priority).
 */
export function farmerWithDropsState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('nearby.drops', 5);
  return ws;
}

/**
 * Preset: Farmer with full inventory.
 */
export function farmerWithFullInventoryState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('inv.produce', 64);
  ws.set('inv.emptySlots', 0);
  ws.set('state.inventoryFull', true);
  ws.set('can.harvest', false);
  return ws;
}

/**
 * Preset: Farmer needing a hoe, has materials.
 */
export function farmerNeedingHoeWithMaterialsState(): WorldState {
  const ws = freshSpawnFarmerState();
  ws.set('inv.logs', 4);
  ws.set('derived.canCraftHoe', true);
  ws.set('nearby.craftingTables', 1);
  return ws;
}

/**
 * Preset: Farmer needing a hoe, no materials but has chest access.
 */
export function farmerNeedingHoeWithChestState(): WorldState {
  const ws = freshSpawnFarmerState();
  ws.set('derived.hasStorageAccess', true);
  ws.set('nearby.chests', 1);
  return ws;
}

/**
 * Preset: Farmer ready to plant with hoe, seeds, and farmland.
 */
export function farmerReadyToPlantState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('inv.seeds', 30);
  ws.set('nearby.farmland', 20);
  ws.set('can.plant', true);
  return ws;
}

/**
 * Preset: Farmer needs to till ground (has hoe but little farmland).
 */
export function farmerNeedsTillingState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('nearby.farmland', 5);
  ws.set('nearby.water', 3);
  ws.set('can.till', true);
  return ws;
}

/**
 * Preset: Farmer with no farm established yet (just found water).
 */
export function farmerFoundWaterState(): WorldState {
  const ws = freshSpawnFarmerState();
  ws.set('has.studiedSigns', true);
  ws.set('nearby.water', 3);
  ws.set('derived.hasFarmEstablished', false);
  return ws;
}

/**
 * Preset: Farmer gathering seeds (no hoe, has farm).
 */
export function farmerGatheringSeedsState(): WorldState {
  const ws = freshSpawnFarmerState();
  ws.set('has.studiedSigns', true);
  ws.set('derived.hasFarmEstablished', true);
  ws.set('has.hoe', false);
  ws.set('inv.seeds', 2);
  ws.set('nearby.grass', 10);
  return ws;
}

/**
 * Preset: Farmer in active trade.
 */
export function farmerInActiveTradeState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('trade.status', 'traveling');
  ws.set('trade.inTrade', true);
  return ws;
}

/**
 * Preset: Farmer with pending trade offers.
 */
export function farmerWithTradeOffersState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('trade.pendingOffers', 2);
  ws.set('trade.inTrade', false);
  ws.set('trade.status', '');
  return ws;
}

/**
 * Preset: Farmer with FARM sign pending (critical priority).
 */
export function farmerWithFarmSignPendingState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('pending.signWrites', 1);
  ws.set('pending.hasFarmSign', true);
  ws.set('has.sign', false);
  ws.set('derived.canCraftSign', true);
  return ws;
}

/**
 * Preset: Farmer with unknown signs nearby.
 */
export function farmerWithUnknownSignsState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('nearby.unknownSigns', 2);
  return ws;
}

/**
 * Preset: Farmer idle (nothing productive to do).
 */
export function farmerIdleState(): WorldState {
  const ws = establishedFarmerState();
  ws.set('nearby.matureCrops', 0);
  ws.set('nearby.farmland', 0);
  ws.set('nearby.drops', 0);
  ws.set('can.plant', false);
  ws.set('can.till', false);
  ws.set('can.harvest', false);
  ws.set('state.consecutiveIdleTicks', 10);
  return ws;
}

/**
 * Preset: Farmer with tradeable items (idle, can broadcast).
 */
export function farmerWithTradeableItemsState(): WorldState {
  const ws = farmerIdleState();
  ws.set('trade.tradeableCount', 8);
  ws.set('trade.inTrade', false);
  ws.set('trade.onCooldown', false);
  ws.set('trade.status', '');
  return ws;
}
