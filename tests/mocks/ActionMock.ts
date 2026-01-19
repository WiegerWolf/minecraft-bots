import type { Bot } from 'mineflayer';
import {
  type GOAPAction,
  type Precondition,
  type Effect,
  ActionResult,
  numericPrecondition,
  booleanPrecondition,
  incrementEffect,
  setEffect,
} from '../../src/planning/Action';
import { WorldState } from '../../src/planning/WorldState';

/**
 * Configuration for creating a mock action.
 */
export interface MockActionConfig {
  name: string;
  preconditions?: Precondition[];
  effects?: Effect[];
  cost?: number;
  executeResult?: ActionResult;
  executeFn?: (bot: Bot, bb: any, ws: WorldState) => Promise<ActionResult>;
}

/**
 * Create a mock GOAP action for testing.
 * The action can be configured to succeed, fail, or run custom logic.
 */
export function createMockAction(config: MockActionConfig): GOAPAction {
  return {
    name: config.name,
    preconditions: config.preconditions ?? [],
    effects: config.effects ?? [],
    getCost: () => config.cost ?? 1.0,
    execute: config.executeFn ?? (async () => config.executeResult ?? ActionResult.SUCCESS),
    cancel: () => {},
  };
}

// ============================================================================
// Reusable test actions that mirror real farming actions
// ============================================================================

/**
 * Mock PickupItems action.
 */
export function mockPickupItemsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'PickupItems',
    preconditions: [
      numericPrecondition('nearby.drops', (v) => v > 0, 'drops nearby'),
      booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
    ],
    effects: [setEffect('nearby.drops', 0, 'all drops collected')],
    cost: 0.5,
    executeResult: result,
  });
}

/**
 * Mock HarvestCrops action.
 */
export function mockHarvestCropsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'HarvestCrops',
    preconditions: [
      numericPrecondition('nearby.matureCrops', (v) => v > 0, 'mature crops available'),
      booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
    ],
    effects: [
      incrementEffect('inv.produce', 10, 'harvested produce'),
      incrementEffect('inv.seeds', 5, 'got seeds from harvest'),
      setEffect('nearby.matureCrops', 0, 'crops harvested'),
    ],
    cost: 1.0,
    executeResult: result,
  });
}

/**
 * Mock PlantSeeds action.
 */
export function mockPlantSeedsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'PlantSeeds',
    preconditions: [
      booleanPrecondition('has.hoe', true, 'has hoe'),
      numericPrecondition('inv.seeds', (v) => v > 0, 'has seeds'),
      numericPrecondition('nearby.farmland', (v) => v > 0, 'farmland available'),
    ],
    effects: [
      incrementEffect('inv.seeds', -5, 'seeds planted'),
      setEffect('nearby.farmland', 0, 'farmland planted'),
    ],
    cost: 1.5,
    executeResult: result,
  });
}

/**
 * Mock TillGround action.
 */
export function mockTillGroundAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'TillGround',
    preconditions: [
      booleanPrecondition('has.hoe', true, 'has hoe'),
      numericPrecondition('nearby.water', (v) => v > 0, 'water nearby'),
      booleanPrecondition('derived.hasFarmEstablished', true, 'farm center established'),
    ],
    effects: [incrementEffect('nearby.farmland', 10, 'created farmland')],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock CraftHoe action.
 */
export function mockCraftHoeAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CraftHoe',
    preconditions: [
      // Custom checkPreconditions would handle OR logic
      // For testing, simplified to planks >= 4
      numericPrecondition('inv.planks', (v) => v >= 4, 'has planks'),
      numericPrecondition('nearby.craftingTables', (v) => v > 0, 'crafting table nearby'),
    ],
    effects: [
      setEffect('has.hoe', true, 'crafted hoe'),
      incrementEffect('inv.planks', -4, 'used planks'),
    ],
    cost: 3.0,
    executeResult: result,
  });
}

/**
 * Mock GatherSeeds action.
 */
export function mockGatherSeedsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'GatherSeeds',
    preconditions: [], // No preconditions - searches for grass
    effects: [
      incrementEffect('inv.seeds', 5, 'gathered seeds'),
      setEffect('needs.seeds', false, 'has enough seeds'),
    ],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock DepositItems action.
 */
export function mockDepositItemsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'DepositItems',
    preconditions: [
      numericPrecondition('inv.produce', (v) => v > 0, 'has produce to deposit'),
      booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
    ],
    effects: [
      setEffect('inv.produce', 0, 'produce deposited'),
      setEffect('state.inventoryFull', false, 'inventory freed'),
    ],
    cost: 2.5,
    executeResult: result,
  });
}

/**
 * Mock FindFarmCenter action.
 */
export function mockFindFarmCenterAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'FindFarmCenter',
    preconditions: [numericPrecondition('nearby.water', (v) => v > 0, 'water nearby')],
    effects: [setEffect('derived.hasFarmEstablished', true, 'farm center established')],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock Explore action.
 */
export function mockExploreAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'Explore',
    preconditions: [],
    effects: [setEffect('state.consecutiveIdleTicks', 0, 'explored, reset idle')],
    cost: 3.0,
    executeResult: result,
  });
}

/**
 * Mock CheckSharedChest action.
 */
export function mockCheckSharedChestAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CheckSharedChest',
    preconditions: [booleanPrecondition('derived.hasStorageAccess', true, 'has chest access')],
    effects: [
      incrementEffect('inv.logs', 4, 'withdrew logs'),
      incrementEffect('inv.planks', 4, 'withdrew planks'),
    ],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock StudySpawnSigns action.
 */
export function mockStudySpawnSignsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'StudySpawnSigns',
    preconditions: [],
    effects: [setEffect('has.studiedSigns', true, 'studied spawn signs')],
    cost: 5.0,
    executeResult: result,
  });
}

// ============================================================================
// Lumberjack mock actions
// ============================================================================

/**
 * Mock ChopTree action.
 */
export function mockChopTreeAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'ChopTree',
    preconditions: [
      booleanPrecondition('has.axe', true, 'has axe'),
      numericPrecondition('nearby.reachableTrees', (v) => v > 0, 'trees nearby'),
    ],
    effects: [
      incrementEffect('inv.logs', 4, 'chopped logs'),
      setEffect('tree.active', true, 'tree harvest started'),
    ],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock CraftAxe action.
 */
export function mockCraftAxeAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CraftAxe',
    preconditions: [
      numericPrecondition('inv.planks', (v) => v >= 3, 'has planks'),
      numericPrecondition('inv.sticks', (v) => v >= 2, 'has sticks'),
      numericPrecondition('nearby.craftingTables', (v) => v > 0, 'crafting table nearby'),
    ],
    effects: [
      setEffect('has.axe', true, 'crafted axe'),
      incrementEffect('inv.planks', -3, 'used planks'),
      incrementEffect('inv.sticks', -2, 'used sticks'),
    ],
    cost: 3.0,
    executeResult: result,
  });
}

/**
 * Mock DepositLogs action.
 */
export function mockDepositLogsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'DepositLogs',
    preconditions: [
      numericPrecondition('inv.logs', (v) => v > 0, 'has logs to deposit'),
      booleanPrecondition('derived.hasStorageAccess', true, 'has chest access'),
    ],
    effects: [
      setEffect('inv.logs', 0, 'logs deposited'),
      setEffect('state.inventoryFull', false, 'inventory freed'),
    ],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock ProcessWood action.
 */
export function mockProcessWoodAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'ProcessWood',
    preconditions: [
      numericPrecondition('inv.logs', (v) => v >= 1, 'has logs'),
    ],
    effects: [
      incrementEffect('inv.logs', -1, 'used log'),
      incrementEffect('inv.planks', 4, 'crafted planks'),
    ],
    cost: 1.0,
    executeResult: result,
  });
}

/**
 * Mock FinishTreeHarvest action.
 */
export function mockFinishTreeHarvestAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'FinishTreeHarvest',
    preconditions: [booleanPrecondition('tree.active', true, 'tree harvest in progress')],
    effects: [setEffect('tree.active', false, 'tree harvest complete')],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock PlantSaplings action.
 */
export function mockPlantSaplingsAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'PlantSaplings',
    preconditions: [
      numericPrecondition('inv.saplings', (v) => v > 0, 'has saplings'),
      booleanPrecondition('tree.active', false, 'not actively harvesting'),
    ],
    effects: [incrementEffect('inv.saplings', -1, 'planted sapling')],
    cost: 1.5,
    executeResult: result,
  });
}

/**
 * Mock WithdrawSupplies action.
 */
export function mockWithdrawSuppliesAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'WithdrawSupplies',
    preconditions: [
      booleanPrecondition('has.checkedStorage', false, 'has not checked storage'),
      booleanPrecondition('derived.hasStorageAccess', true, 'has storage access'),
    ],
    effects: [
      setEffect('has.checkedStorage', true, 'checked storage'),
      setEffect('has.axe', true, 'may have found axe'),
    ],
    cost: 1.5,
    executeResult: result,
  });
}

/**
 * Mock RespondToNeed action.
 */
export function mockRespondToNeedAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'RespondToNeed',
    preconditions: [
      booleanPrecondition('has.incomingNeeds', true, 'incoming needs exist'),
      numericPrecondition('inv.logs', (v) => v >= 2, 'has logs to provide'),
    ],
    effects: [setEffect('has.incomingNeeds', false, 'needs fulfilled')],
    cost: 2.0,
    executeResult: result,
  });
}

/**
 * Mock CraftAndPlaceCraftingTable action.
 */
export function mockCraftCraftingTableAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CraftAndPlaceCraftingTable',
    preconditions: [
      booleanPrecondition('derived.needsCraftingTable', true, 'needs crafting table'),
      numericPrecondition('inv.planks', (v) => v >= 4, 'has planks'),
    ],
    effects: [
      setEffect('derived.needsCraftingTable', false, 'has crafting table now'),
      setEffect('has.craftingTable', true, 'crafting table available'),
      incrementEffect('inv.planks', -4, 'used planks'),
    ],
    cost: 2.5,
    executeResult: result,
  });
}

/**
 * Mock CraftChest action.
 */
export function mockCraftChestAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CraftChest',
    preconditions: [
      booleanPrecondition('derived.needsChest', true, 'needs chest'),
      numericPrecondition('inv.planks', (v) => v >= 8, 'has planks for chest'),
    ],
    effects: [
      setEffect('derived.needsChest', false, 'has chest now'),
      setEffect('derived.hasStorageAccess', true, 'has storage access'),
      incrementEffect('inv.planks', -8, 'used planks'),
    ],
    cost: 3.0,
    executeResult: result,
  });
}

/**
 * Mock WriteKnowledgeSign action.
 */
export function mockWriteKnowledgeSignAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'WriteKnowledgeSign',
    preconditions: [numericPrecondition('pending.signWrites', (v) => v > 0, 'has pending sign writes')],
    effects: [incrementEffect('pending.signWrites', -1, 'wrote sign')],
    cost: 4.0,
    executeResult: result,
  });
}

/**
 * Mock PatrolForest action.
 */
export function mockPatrolForestAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'PatrolForest',
    preconditions: [],
    effects: [
      setEffect('nearby.reachableTrees', 1, 'may find trees'),
      setEffect('state.consecutiveIdleTicks', 0, 'explored'),
    ],
    cost: 10.0,
    executeResult: result,
  });
}

/**
 * Mock BroadcastTradeOffer action.
 */
export function mockBroadcastTradeOfferAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'BroadcastTradeOffer',
    preconditions: [
      numericPrecondition('trade.tradeableCount', (v) => v >= 4, 'has tradeable items'),
      booleanPrecondition('trade.inTrade', false, 'not in trade'),
      booleanPrecondition('trade.onCooldown', false, 'not on cooldown'),
    ],
    effects: [setEffect('trade.status', 'accepted', 'trade accepted')],
    cost: 1.0,
    executeResult: result,
  });
}

/**
 * Mock RespondToTradeOffer action.
 */
export function mockRespondToTradeOfferAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'RespondToTradeOffer',
    preconditions: [
      numericPrecondition('trade.pendingOffers', (v) => v > 0, 'has pending offers'),
      booleanPrecondition('trade.inTrade', false, 'not in trade'),
    ],
    effects: [setEffect('trade.status', 'wanting', 'responded to offer')],
    cost: 0.5,
    executeResult: result,
  });
}

/**
 * Mock CompleteTrade action.
 */
export function mockCompleteTradeAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CompleteTrade',
    preconditions: [
      // Custom check would handle multiple active statuses
      // For mock, we'll use a simpler approach
      booleanPrecondition('trade.inTrade', true, 'has active trade'),
    ],
    effects: [
      setEffect('trade.status', 'done', 'trade completed'),
      setEffect('trade.inTrade', false, 'no longer in trade'),
    ],
    cost: 0.5,
    executeResult: result,
  });
}

/**
 * Mock ReadUnknownSign action.
 */
export function mockReadUnknownSignAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'ReadUnknownSign',
    preconditions: [numericPrecondition('nearby.unknownSigns', (v) => v > 0, 'unknown signs nearby')],
    effects: [incrementEffect('nearby.unknownSigns', -1, 'read a sign')],
    cost: 2.0,
    executeResult: result,
  });
}

// ============================================================================
// Landscaper mock actions
// ============================================================================

/**
 * Mock CraftShovel action.
 */
export function mockCraftShovelAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CraftShovel',
    preconditions: [
      numericPrecondition('inv.planks', (v) => v >= 1, 'has planks'),
      numericPrecondition('inv.sticks', (v) => v >= 2, 'has sticks'),
      numericPrecondition('nearby.craftingTables', (v) => v > 0, 'crafting table nearby'),
    ],
    effects: [
      setEffect('has.shovel', true, 'crafted shovel'),
      incrementEffect('inv.planks', -1, 'used plank'),
      incrementEffect('inv.sticks', -2, 'used sticks'),
    ],
    cost: 3.0,
    executeResult: result,
  });
}

/**
 * Mock CraftPickaxe action.
 */
export function mockCraftPickaxeAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'CraftPickaxe',
    preconditions: [
      numericPrecondition('inv.planks', (v) => v >= 3, 'has planks'),
      numericPrecondition('inv.sticks', (v) => v >= 2, 'has sticks'),
      numericPrecondition('nearby.craftingTables', (v) => v > 0, 'crafting table nearby'),
    ],
    effects: [
      setEffect('has.pickaxe', true, 'crafted pickaxe'),
      incrementEffect('inv.planks', -3, 'used planks'),
      incrementEffect('inv.sticks', -2, 'used sticks'),
    ],
    cost: 3.0,
    executeResult: result,
  });
}

/**
 * Mock TerraformArea action.
 */
export function mockTerraformAreaAction(result = ActionResult.SUCCESS): GOAPAction {
  return createMockAction({
    name: 'TerraformArea',
    preconditions: [
      booleanPrecondition('has.shovel', true, 'has shovel'),
      booleanPrecondition('has.pickaxe', true, 'has pickaxe'),
      booleanPrecondition('has.pendingTerraformRequest', true, 'terraform request pending'),
    ],
    effects: [
      setEffect('has.pendingTerraformRequest', false, 'terraform complete'),
      setEffect('terraform.active', false, 'terraform done'),
    ],
    cost: 5.0,
    executeResult: result,
  });
}

// ============================================================================
// Helper to get a complete set of farming actions
// ============================================================================

export function createFarmingActionSet(): GOAPAction[] {
  return [
    mockPickupItemsAction(),
    mockHarvestCropsAction(),
    mockPlantSeedsAction(),
    mockTillGroundAction(),
    mockDepositItemsAction(),
    mockGatherSeedsAction(),
    mockCraftHoeAction(),
    mockFindFarmCenterAction(),
    mockExploreAction(),
    mockCheckSharedChestAction(),
    mockStudySpawnSignsAction(),
  ];
}

export function createLumberjackActionSet(): GOAPAction[] {
  return [
    // Trade actions (high priority when applicable)
    mockCompleteTradeAction(),
    mockRespondToTradeOfferAction(),
    mockBroadcastTradeOfferAction(),

    // Startup actions
    mockStudySpawnSignsAction(),
    mockWithdrawSuppliesAction(),

    // Core lumberjack actions
    mockPickupItemsAction(),
    mockChopTreeAction(),
    mockFinishTreeHarvestAction(),
    mockPlantSaplingsAction(),
    mockDepositLogsAction(),
    mockCraftAxeAction(),
    mockRespondToNeedAction(),
    mockProcessWoodAction(),

    // Infrastructure actions
    mockCraftCraftingTableAction(),
    mockCraftChestAction(),
    mockWriteKnowledgeSignAction(),
    mockReadUnknownSignAction(),

    // Fallback
    mockPatrolForestAction(),
    mockExploreAction(),
  ];
}

export function createLandscaperActionSet(): GOAPAction[] {
  return [
    mockPickupItemsAction(),
    mockCraftShovelAction(),
    mockCraftPickaxeAction(),
    mockTerraformAreaAction(),
    mockStudySpawnSignsAction(),
    mockExploreAction(),
  ];
}
