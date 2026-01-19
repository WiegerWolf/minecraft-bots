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

// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL FARMER PRESETS
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL LUMBERJACK PRESETS
// ═══════════════════════════════════════════════════════════════════════════

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
  ws.set('has.pendingRequests', true);
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
