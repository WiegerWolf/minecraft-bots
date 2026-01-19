import { WorldState } from '../../src/planning/WorldState';
import { Vec3Mock, vec3 } from './Vec3Mock';

/**
 * Type for WorldState fact values (matches the real type).
 */
export type FactValue = number | boolean | string | Vec3Mock | null;

/**
 * Create a WorldState with preset facts.
 */
export function createWorldState(facts: Record<string, FactValue> = {}): WorldState {
  const ws = new WorldState();
  for (const [key, value] of Object.entries(facts)) {
    ws.set(key, value as any);
  }
  return ws;
}

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

    'has.pendingRequests': false,
    'has.studiedSigns': false,
    'has.checkedStorage': false,

    'tree.active': false,
    'tree.phase': '',

    'trade.status': '',
    'trade.inTrade': false,
    'trade.tradeableCount': 0,
    'trade.pendingOffers': 0,
    'trade.onCooldown': false,
  });
}

/**
 * Preset: Lumberjack with axe and trees nearby.
 */
export function lumberjackReadyToChopState(): WorldState {
  const ws = freshSpawnLumberjackState();
  ws.set('has.axe', true);
  ws.set('nearby.reachableTrees', 5);
  ws.set('has.studiedSigns', true);
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
