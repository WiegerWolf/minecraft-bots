import { Vec3Mock, vec3 } from './Vec3Mock';

/**
 * Mock block for testing.
 */
export interface MockBlock {
  position: Vec3Mock;
  name: string;
  type: number;
}

/**
 * Mock entity for testing.
 */
export interface MockEntity {
  id: number;
  position: Vec3Mock;
  name: string;
  type: string;
}

/**
 * Farming blackboard mock for testing.
 * Mirrors the structure of FarmingBlackboard.
 */
export interface FarmingBlackboardMock {
  // Perception
  nearbyWater: MockBlock[];
  nearbyFarmland: MockBlock[];
  nearbyMatureCrops: MockBlock[];
  nearbyGrass: MockBlock[];
  nearbyDrops: MockEntity[];
  nearbyChests: MockBlock[];
  nearbyCraftingTables: MockBlock[];

  // Inventory state
  hasHoe: boolean;
  hasSword: boolean;
  hasAxe: boolean;
  seedCount: number;
  produceCount: number;
  emptySlots: number;
  logCount: number;
  plankCount: number;
  stickCount: number;

  // Strategic state
  farmCenter: Vec3Mock | null;
  farmChest: Vec3Mock | null;
  sharedChest: Vec3Mock | null;
  sharedCraftingTable: Vec3Mock | null;

  // Computed flags
  canTill: boolean;
  canPlant: boolean;
  canHarvest: boolean;
  needsTools: boolean;
  needsSeeds: boolean;
  inventoryFull: boolean;

  // Memory systems
  exploredPositions: Array<{ position: Vec3Mock; timestamp: number }>;
  badWaterPositions: Array<{ position: Vec3Mock; timestamp: number }>;
  unreachableDrops: Map<number, number>;

  // Sign knowledge
  spawnPosition: Vec3Mock | null;
  hasStudiedSigns: boolean;
  readSignPositions: Set<string>;
  unknownSigns: Vec3Mock[];
  pendingSignWrites: Array<{ type: string; pos: Vec3Mock }>;
  knownFarms: Vec3Mock[];
  knownWaterSources: Vec3Mock[];

  // Trade state
  tradeableItems: Array<{ name: string; count: number }>;
  tradeableItemCount: number;
  pendingTradeOffers: Array<{ from: string; item: string; quantity: number }>;
  activeTrade: {
    partner: string;
    item: string;
    quantity: number;
    status: string;
    role: 'giver' | 'receiver';
  } | null;
  lastOfferTime: number;

  // Tracking
  lastAction: string;
  consecutiveIdleTicks: number;

  // External references (null in tests)
  villageChat: null;
  log: null;
  stuckTracker: null;
}

/**
 * Create a default farming blackboard for testing.
 */
export function createFarmingBlackboardMock(
  overrides: Partial<FarmingBlackboardMock> = {}
): FarmingBlackboardMock {
  return {
    // Perception - default empty
    nearbyWater: [],
    nearbyFarmland: [],
    nearbyMatureCrops: [],
    nearbyGrass: [],
    nearbyDrops: [],
    nearbyChests: [],
    nearbyCraftingTables: [],

    // Inventory - default no items
    hasHoe: false,
    hasSword: false,
    hasAxe: false,
    seedCount: 0,
    produceCount: 0,
    emptySlots: 36,
    logCount: 0,
    plankCount: 0,
    stickCount: 0,

    // Strategic - default not established
    farmCenter: null,
    farmChest: null,
    sharedChest: null,
    sharedCraftingTable: null,

    // Computed - default can't do anything
    canTill: false,
    canPlant: false,
    canHarvest: false,
    needsTools: true,
    needsSeeds: true,
    inventoryFull: false,

    // Memory - default empty
    exploredPositions: [],
    badWaterPositions: [],
    unreachableDrops: new Map(),

    // Signs - default not studied
    spawnPosition: vec3(0, 64, 0),
    hasStudiedSigns: false,
    readSignPositions: new Set(),
    unknownSigns: [],
    pendingSignWrites: [],
    knownFarms: [],
    knownWaterSources: [],

    // Trade - default idle
    tradeableItems: [],
    tradeableItemCount: 0,
    pendingTradeOffers: [],
    activeTrade: null,
    lastOfferTime: 0,

    // Tracking
    lastAction: '',
    consecutiveIdleTicks: 0,

    // External references
    villageChat: null,
    log: null,
    stuckTracker: null,

    // Apply overrides
    ...overrides,
  };
}

/**
 * Lumberjack blackboard mock.
 */
export interface LumberjackBlackboardMock {
  nearbyTrees: MockBlock[];
  nearbyLogs: MockBlock[];
  nearbyDrops: MockEntity[];
  nearbyChests: MockBlock[];
  nearbyCraftingTables: MockBlock[];

  hasAxe: boolean;
  logCount: number;
  plankCount: number;
  stickCount: number;
  saplingCount: number;
  emptySlots: number;

  sharedChest: Vec3Mock | null;
  sharedCraftingTable: Vec3Mock | null;
  villageCenter: Vec3Mock | null;

  needsToDeposit: boolean;
  canChop: boolean;
  hasPendingRequests: boolean;
  inventoryFull: boolean;

  currentTreeHarvest: {
    active: boolean;
    phase: string;
    basePos: Vec3Mock | null;
  } | null;

  spawnPosition: Vec3Mock | null;
  hasStudiedSigns: boolean;
  pendingSignWrites: Array<{ type: string; pos: Vec3Mock }>;

  villageChat: null;
  log: null;
}

export function createLumberjackBlackboardMock(
  overrides: Partial<LumberjackBlackboardMock> = {}
): LumberjackBlackboardMock {
  return {
    nearbyTrees: [],
    nearbyLogs: [],
    nearbyDrops: [],
    nearbyChests: [],
    nearbyCraftingTables: [],

    hasAxe: false,
    logCount: 0,
    plankCount: 0,
    stickCount: 0,
    saplingCount: 0,
    emptySlots: 36,

    sharedChest: null,
    sharedCraftingTable: null,
    villageCenter: null,

    needsToDeposit: false,
    canChop: false,
    hasPendingRequests: false,
    inventoryFull: false,

    currentTreeHarvest: null,

    spawnPosition: vec3(0, 64, 0),
    hasStudiedSigns: false,
    pendingSignWrites: [],

    villageChat: null,
    log: null,

    ...overrides,
  };
}

/**
 * Landscaper blackboard mock.
 */
export interface LandscaperBlackboardMock {
  nearbyDrops: MockEntity[];
  nearbyChests: MockBlock[];
  nearbyCraftingTables: MockBlock[];

  hasShovel: boolean;
  hasPickaxe: boolean;
  dirtCount: number;
  cobblestoneCount: number;
  slabCount: number;
  logCount: number;
  plankCount: number;
  emptySlots: number;

  sharedChest: Vec3Mock | null;
  sharedCraftingTable: Vec3Mock | null;

  currentTerraformTask: {
    position: Vec3Mock;
    status: string;
  } | null;
  hasPendingTerraformRequest: boolean;
  inventoryFull: boolean;

  knownFarms: Vec3Mock[];
  farmsNeedingCheck: number;
  farmsWithIssues: number;

  spawnPosition: Vec3Mock | null;
  hasStudiedSigns: boolean;

  villageChat: null;
  log: null;
}

export function createLandscaperBlackboardMock(
  overrides: Partial<LandscaperBlackboardMock> = {}
): LandscaperBlackboardMock {
  return {
    nearbyDrops: [],
    nearbyChests: [],
    nearbyCraftingTables: [],

    hasShovel: false,
    hasPickaxe: false,
    dirtCount: 0,
    cobblestoneCount: 0,
    slabCount: 0,
    logCount: 0,
    plankCount: 0,
    emptySlots: 36,

    sharedChest: null,
    sharedCraftingTable: null,

    currentTerraformTask: null,
    hasPendingTerraformRequest: false,
    inventoryFull: false,

    knownFarms: [],
    farmsNeedingCheck: 0,
    farmsWithIssues: 0,

    spawnPosition: vec3(0, 64, 0),
    hasStudiedSigns: false,

    villageChat: null,
    log: null,

    ...overrides,
  };
}

/**
 * Helper to create mock blocks.
 */
export function mockBlock(name: string, x: number, y: number, z: number): MockBlock {
  return { name, position: vec3(x, y, z), type: 0 };
}

/**
 * Helper to create mock entities (drops).
 */
export function mockEntity(name: string, x: number, y: number, z: number, id = Math.floor(Math.random() * 10000)): MockEntity {
  return { id, name, position: vec3(x, y, z), type: 'item' };
}
