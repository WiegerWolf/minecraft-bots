import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat, TradeOffer, ActiveTrade } from '../../shared/VillageChat';
import { LOG_NAMES, LEAF_NAMES, SAPLING_NAMES, LOG_TO_LEAF_MAP, type TreeHarvestState } from '../shared/TreeHarvest';
import type { Logger } from '../../shared/logger';
import { SIGN_SEARCH_RADIUS } from '../../shared/SignKnowledge';
import { type StuckTracker, createStuckTracker } from '../../shared/PathfindingUtils';
import { type InventoryItem, getTradeableItems, isWantedByRole } from '../../shared/ItemCategories';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;
}

/**
 * Pending sign write entry - queued when infrastructure is placed or forest discovered
 */
export interface PendingSignWrite {
    type: 'VILLAGE' | 'CRAFT' | 'CHEST' | 'FOREST';
    pos: Vec3;
}

export interface LumberjackBlackboard {
    // Perception data (refreshed each tick)
    nearbyTrees: Block[];       // Log blocks that could be tree bases (reachable)
    forestTrees: Block[];       // Trees in actual forests (safe to chop - not buildings!)
    nearbyLogs: Block[];        // All log blocks
    nearbyLeaves: Block[];      // Leaf blocks
    nearbyDrops: any[];         // Dropped items
    nearbyChests: Block[];      // Chest blocks
    nearbyCraftingTables: Block[]; // Crafting table blocks

    // Inventory summary
    logCount: number;
    plankCount: number;
    stickCount: number;
    saplingCount: number;
    hasAxe: boolean;
    emptySlots: number;

    // Strategic state (persists across ticks)
    villageCenter: Vec3 | null;
    sharedChest: Vec3 | null;              // Primary chest (first discovered)
    sharedCraftingTable: Vec3 | null;
    currentTreeHarvest: TreeHarvestState | null;

    // Multiple chests support
    knownChests: Vec3[];                   // All known chest positions (from signs, chat, discovery)
    knownForests: Vec3[];                  // Known good forest/tree areas (from signs)
    hasKnownForest: boolean;               // Whether bot knows about a valid forest

    // Village communication (set by role)
    villageChat: VillageChat | null;

    // Logger (set by role)
    log: Logger | null;

    // Exploration memory
    exploredPositions: ExplorationMemory[];

    // Unreachable items tracking (entity id -> expiry timestamp)
    unreachableDrops: Map<number, number>;

    // Computed booleans
    inventoryFull: boolean;
    canChop: boolean;
    needsToDeposit: boolean;
    hasPendingRequests: boolean;

    // Action tracking
    lastAction: string;
    consecutiveIdleTicks: number;

    // Sign-based persistent knowledge system
    spawnPosition: Vec3 | null;           // Where bot spawned (sign location)
    pendingSignWrites: PendingSignWrite[]; // Queue of signs to write
    signPositions: Map<string, Vec3>;     // type -> sign block position (for updates)

    // Full chest tracking (position string -> expiry timestamp)
    fullChests: Map<string, number>;

    // Startup behaviors (one-time on spawn)
    hasStudiedSigns: boolean;             // Has bot walked to and read signs near spawn
    hasCheckedStorage: boolean;           // Has bot checked chest for startup supplies

    // Curious bot - sign tracking
    readSignPositions: Set<string>;       // Sign positions we've read (stringified: "x,y,z")
    unknownSigns: Vec3[];                 // Signs spotted but not yet read

    // Stuck detection for hole escape
    stuckTracker: StuckTracker;

    // ═══════════════════════════════════════════════════════════════
    // TRADE STATE
    // ═══════════════════════════════════════════════════════════════
    tradeableItems: InventoryItem[];            // Items we can offer for trade
    tradeableItemCount: number;                 // Total count of tradeable items
    pendingTradeOffers: TradeOffer[];           // Active offers from other bots we might want
    activeTrade: ActiveTrade | null;            // Current trade state (if any)
    lastOfferTime: number;                      // When we last broadcast an offer (cooldown)
}

export function createLumberjackBlackboard(): LumberjackBlackboard {
    return {
        nearbyTrees: [],
        forestTrees: [],
        nearbyLogs: [],
        nearbyLeaves: [],
        nearbyDrops: [],
        nearbyChests: [],
        nearbyCraftingTables: [],

        logCount: 0,
        plankCount: 0,
        stickCount: 0,
        saplingCount: 0,
        hasAxe: false,
        emptySlots: 36,

        villageCenter: null,
        sharedChest: null,
        sharedCraftingTable: null,
        currentTreeHarvest: null,

        // Multiple chests/landmarks
        knownChests: [],
        knownForests: [],
        hasKnownForest: false,

        villageChat: null,
        log: null,

        exploredPositions: [],
        unreachableDrops: new Map(),

        inventoryFull: false,
        canChop: true,
        needsToDeposit: false,
        hasPendingRequests: false,

        lastAction: 'none',
        consecutiveIdleTicks: 0,

        // Sign-based persistent knowledge
        spawnPosition: null,
        pendingSignWrites: [],
        signPositions: new Map(),

        // Full chest tracking
        fullChests: new Map(),

        // Startup behaviors
        hasStudiedSigns: false,
        hasCheckedStorage: false,

        // Curious bot - sign tracking
        readSignPositions: new Set(),
        unknownSigns: [],

        // Stuck detection
        stuckTracker: createStuckTracker(),

        // Trade state
        tradeableItems: [],
        tradeableItemCount: 0,
        pendingTradeOffers: [],
        activeTrade: null,
        lastOfferTime: 0,
    };
}

export async function updateLumberjackBlackboard(bot: Bot, bb: LumberjackBlackboard): Promise<void> {
    const pos = bot.entity.position;
    const inv = bot.inventory.items();

    // ═══════════════════════════════════════════════
    // INVENTORY ANALYSIS
    // ═══════════════════════════════════════════════
    bb.hasAxe = inv.some(i => i.name.includes('axe'));
    bb.emptySlots = bot.inventory.emptySlotCount();
    bb.inventoryFull = bb.emptySlots < 3;

    bb.logCount = inv.filter(i => LOG_NAMES.some(l => i.name === l)).reduce((s, i) => s + i.count, 0);
    bb.plankCount = inv.filter(i => i.name.endsWith('_planks')).reduce((s, i) => s + i.count, 0);
    bb.stickCount = inv.filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0);
    bb.saplingCount = inv.filter(i => SAPLING_NAMES.includes(i.name)).reduce((s, i) => s + i.count, 0);

    // ═══════════════════════════════════════════════
    // VILLAGE STATE (from chat)
    // ═══════════════════════════════════════════════
    if (bb.villageChat) {
        bb.villageCenter = bb.villageChat.getVillageCenter();
        bb.sharedChest = bb.villageChat.getSharedChest();
        bb.sharedCraftingTable = bb.villageChat.getSharedCraftingTable();

        // Check for pending requests this bot can fulfill
        const canProvide = ['log', 'planks', 'stick'];
        const requests = bb.villageChat.getRequestsToFulfill(canProvide);
        bb.hasPendingRequests = requests.length > 0;
    }

    // ═══════════════════════════════════════════════
    // WORLD PERCEPTION
    // ═══════════════════════════════════════════════
    const searchCenter = bb.villageCenter || pos;
    // Search radius must match ChopTree's startTreeHarvest radius (50 with village, 32 without)
    // Otherwise planner thinks trees exist but action can't find them
    const SEARCH_RADIUS = bb.villageCenter ? 50 : 32;

    // Find logs
    bb.nearbyLogs = bot.findBlocks({
        point: searchCenter,
        maxDistance: SEARCH_RADIUS,
        count: 20,
        matching: b => {
            if (!b || !b.name) return false;
            return LOG_NAMES.includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Find REACHABLE tree bases (logs with valid ground AND walkable access)
    // Valid ground includes: dirt variants, mangrove roots, mud, or other logs (for tall trees)
    const VALID_TREE_BASE = [
        'dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt',
        'mangrove_roots', 'muddy_mangrove_roots', 'mud', // Mangrove swamp blocks
        'moss_block', 'clay', 'sand', // Additional valid surfaces
    ];

    // Blocks that count as solid/walkable ground
    const isWalkableGround = (blockName: string | undefined): boolean => {
        if (!blockName) return false;
        // Air, water, leaves are NOT walkable
        if (blockName === 'air' || blockName === 'water' || blockName.includes('leaves')) return false;
        // Most other solid blocks are walkable
        return true;
    };

    bb.nearbyTrees = bb.nearbyLogs.filter(log => {
        // Skip logs more than 5 blocks above bot (unreachable canopy)
        if (log.position.y > bot.entity.position.y + 5) return false;

        // Skip logs more than 10 blocks below bot (likely stuck on canopy, can't path down)
        if (log.position.y < bot.entity.position.y - 10) return false;

        const below = bot.blockAt(log.position.offset(0, -1, 0));
        if (!below) return false;

        // Must be a valid tree base (on ground or another log)
        const isValidBase = VALID_TREE_BASE.includes(below.name) || LOG_NAMES.includes(below.name);
        if (!isValidBase) return false;

        // Critical: Check if there's walkable ground adjacent to the tree base
        // This ensures the bot can actually stand next to the tree to chop it
        const adjacentOffsets = [
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1),
        ];

        let hasWalkableAccess = false;
        for (const offset of adjacentOffsets) {
            const adjacentPos = log.position.plus(offset);
            const groundBlock = bot.blockAt(adjacentPos.offset(0, -1, 0));
            const feetBlock = bot.blockAt(adjacentPos);
            const headBlock = bot.blockAt(adjacentPos.offset(0, 1, 0));

            // Need: solid ground below, air at feet and head level
            if (groundBlock && isWalkableGround(groundBlock.name) &&
                feetBlock && (feetBlock.name === 'air' || feetBlock.name === 'water') &&
                headBlock && (headBlock.name === 'air' || headBlock.name === 'water' || headBlock.name.includes('leaves'))) {
                hasWalkableAccess = true;
                break;
            }
        }

        return hasWalkableAccess;
    });

    // Debug logging for tree detection
    if (bb.nearbyLogs.length > 0 && bb.nearbyTrees.length === 0) {
        bb.log?.debug({ logCount: bb.nearbyLogs.length, botY: Math.floor(pos.y) }, 'Found logs but 0 reachable trees');
    }

    // ═══════════════════════════════════════════════
    // FOREST DETECTION & STRUCTURE AVOIDANCE
    // Only chop trees that are part of actual forests (3+ trees in cluster)
    // Avoid logs near structures (village houses, etc.)
    // ═══════════════════════════════════════════════
    bb.forestTrees = filterForestTrees(bot, bb.nearbyTrees, bb.knownForests, bb.log);

    // Update hasKnownForest based on whether we have knownForests or detected a forest cluster
    bb.hasKnownForest = bb.knownForests.length > 0 || bb.forestTrees.length >= 3;

    // If we discovered a new forest cluster and don't have a pending FOREST sign write, queue one
    const hasPendingForestSign = bb.pendingSignWrites.some(p => p.type === 'FOREST');
    if (bb.forestTrees.length >= 5 && bb.knownForests.length === 0 && !hasPendingForestSign && bb.hasStudiedSigns) {
        // Store the forest center for sign writing
        const forestCenter = getClusterCenter(bb.forestTrees.map(t => t.position));
        if (forestCenter && !bb.knownForests.some(f => f.distanceTo(forestCenter) < 30)) {
            bb.knownForests.push(forestCenter);
            bb.pendingSignWrites.push({ type: 'FOREST', pos: forestCenter.clone() });
            bb.log?.info({ pos: forestCenter.floored().toString(), treeCount: bb.forestTrees.length }, 'Discovered forest area!');
        }
    }

    // Find leaves (for clearing)
    bb.nearbyLeaves = bot.findBlocks({
        point: pos,
        maxDistance: 16,
        count: 30,
        matching: b => {
            if (!b || !b.name) return false;
            return LEAF_NAMES.includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Clean up expired unreachable entries
    const now = Date.now();
    for (const [id, expiry] of bb.unreachableDrops) {
        if (now >= expiry) {
            bb.unreachableDrops.delete(id);
        }
    }

    // Find dropped items - filter to only include reachable ones
    bb.nearbyDrops = Object.values(bot.entities).filter(e => {
        if (e.name !== 'item' || !e.position) return false;
        if (e.position.distanceTo(pos) >= 16) return false;

        // Skip items marked as unreachable
        if (bb.unreachableDrops.has(e.id)) return false;

        // Check if the item is on a walkable surface
        // Items floating on leaves/water are not reachable
        const itemPos = e.position;
        const blockBelow = bot.blockAt(itemPos.offset(0, -0.5, 0)); // Check slightly below item

        if (!blockBelow) return true; // Can't check, assume reachable

        // Items on leaves or in water are likely unreachable
        if (blockBelow.name.includes('leaves') || blockBelow.name === 'water') {
            // Exception: if bot is at similar Y level (within 2 blocks), might be reachable
            if (Math.abs(itemPos.y - pos.y) <= 2) {
                return true; // Close enough vertically, might be able to grab it
            }
            return false; // Item is on leaves/water and bot is far below/above
        }

        // Items too high above the bot (more than 5 blocks) are unreachable
        if (itemPos.y > pos.y + 5) return false;

        return true;
    });

    // Find chests
    bb.nearbyChests = bot.findBlocks({
        point: pos,
        maxDistance: 32,
        count: 5,
        matching: b => {
            if (!b || !b.name) return false;
            return ['chest', 'barrel'].includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Find crafting tables
    bb.nearbyCraftingTables = bot.findBlocks({
        point: pos,
        maxDistance: 32,
        count: 3,
        matching: b => {
            if (!b || !b.name) return false;
            return b.name === 'crafting_table';
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // ═══════════════════════════════════════════════
    // SIGN DETECTION (curious bot)
    // ═══════════════════════════════════════════════
    const nearbySigns = bot.findBlocks({
        point: pos,
        maxDistance: SIGN_SEARCH_RADIUS,
        count: 20,
        matching: b => b?.name?.includes('_sign') ?? false
    });

    // Find signs we haven't read yet
    const posToKey = (p: Vec3) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
    bb.unknownSigns = nearbySigns
        .filter(signPos => !bb.readSignPositions.has(posToKey(signPos)))
        .map(p => new Vec3(p.x, p.y, p.z));

    // ═══════════════════════════════════════════════
    // COMPUTED DECISIONS
    // ═══════════════════════════════════════════════
    bb.canChop = bb.nearbyTrees.length > 0 || bb.currentTreeHarvest !== null;
    bb.needsToDeposit = bb.logCount >= 32 || bb.inventoryFull;

    // ═══════════════════════════════════════════════
    // TRADE STATE
    // ═══════════════════════════════════════════════
    // Convert inventory to InventoryItem format
    const invItems: InventoryItem[] = inv.map(i => ({ name: i.name, count: i.count }));

    // Get items we can trade (unwanted + helpful items)
    bb.tradeableItems = getTradeableItems(invItems, 'lumberjack');
    bb.tradeableItemCount = bb.tradeableItems.reduce((sum, item) => sum + item.count, 0);

    // Get trade state from villageChat
    if (bb.villageChat) {
        bb.pendingTradeOffers = bb.villageChat.getActiveOffers()
            .filter(o => isWantedByRole(o.item, 'lumberjack')); // Only offers for items we want
        bb.activeTrade = bb.villageChat.getActiveTrade();

        // Clean up stale offers
        bb.villageChat.cleanupOldTradeOffers();
    }
}

// ═══════════════════════════════════════════════
// EXPLORATION MEMORY HELPERS
// ═══════════════════════════════════════════════

const EXPLORATION_HISTORY_SIZE = 30;
const EXPLORATION_MEMORY_TTL = 5 * 60 * 1000; // 5 minutes

export function recordExploredPosition(bb: LumberjackBlackboard, pos: Vec3, reason: string = 'visited'): void {
    cleanupExplorationMemory(bb);

    bb.exploredPositions.push({
        position: pos.clone(),
        timestamp: Date.now(),
        reason
    });

    if (bb.exploredPositions.length > EXPLORATION_HISTORY_SIZE) {
        bb.exploredPositions.shift();
    }
}

export function cleanupExplorationMemory(bb: LumberjackBlackboard): void {
    const now = Date.now();
    bb.exploredPositions = bb.exploredPositions.filter(
        e => now - e.timestamp < EXPLORATION_MEMORY_TTL
    );
}

export function isNearExplored(bb: LumberjackBlackboard, pos: Vec3, radius: number = 16): boolean {
    return bb.exploredPositions.some(
        e => e.position.distanceTo(pos) < radius
    );
}

export function getExplorationScore(bb: LumberjackBlackboard, pos: Vec3): number {
    let score = 100;

    for (const explored of bb.exploredPositions) {
        const dist = explored.position.distanceTo(pos);
        if (dist < 32) {
            score -= (32 - dist) * 2;
        }
    }

    return score;
}

// ═══════════════════════════════════════════════
// FOREST DETECTION HELPERS
// ═══════════════════════════════════════════════

// Blocks that indicate a man-made structure (not a natural tree)
const STRUCTURE_BLOCKS = [
    // Wood building components
    'oak_stairs', 'birch_stairs', 'spruce_stairs', 'jungle_stairs', 'acacia_stairs', 'dark_oak_stairs',
    'oak_slab', 'birch_slab', 'spruce_slab', 'jungle_slab', 'acacia_slab', 'dark_oak_slab',
    'oak_fence', 'birch_fence', 'spruce_fence', 'jungle_fence', 'acacia_fence', 'dark_oak_fence',
    'oak_fence_gate', 'birch_fence_gate', 'spruce_fence_gate', 'jungle_fence_gate',
    'oak_door', 'birch_door', 'spruce_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
    'oak_trapdoor', 'birch_trapdoor', 'spruce_trapdoor', 'jungle_trapdoor',
    // Planks (floor/walls)
    'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks',
    // Stone building components
    'cobblestone', 'cobblestone_stairs', 'cobblestone_slab', 'cobblestone_wall',
    'stone_bricks', 'stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall',
    'smooth_stone', 'smooth_stone_slab',
    // Other structure indicators
    'glass', 'glass_pane', 'torch', 'wall_torch', 'lantern', 'bell',
    'bed', 'white_bed', 'red_bed', 'blue_bed', 'green_bed', 'yellow_bed',
    'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'barrel', 'chest',
    'lectern', 'composter', 'brewing_stand', 'cauldron', 'anvil',
    'flower_pot', 'bookshelf', 'carpet',
];

// Minimum trees in cluster to be considered a forest
const MIN_FOREST_CLUSTER_SIZE = 3;
// Maximum distance between trees to be in same cluster
const FOREST_CLUSTER_RADIUS = 16;
// Search radius for structure blocks
const STRUCTURE_CHECK_RADIUS = 4;

/**
 * Check if a log block has matching leaves attached (indicating it's a real tree).
 * Real trees have leaves above/around the trunk; structure logs don't.
 *
 * @param bot - The bot instance
 * @param logBlock - The log block to check
 * @param searchRadius - How far to search for leaves (default 5)
 * @param minLeaves - Minimum leaves required to confirm it's a tree (default 3)
 * @returns true if the log has matching leaves attached
 */
function hasLeavesAttached(
    bot: Bot,
    logBlock: Block,
    searchRadius: number = 5,
    minLeaves: number = 3
): boolean {
    const logName = logBlock.name;
    const validLeaves = LOG_TO_LEAF_MAP[logName];
    if (!validLeaves) return false; // Unknown log type

    const logPos = logBlock.position;
    let leafCount = 0;

    // Search above and around the log for matching leaves
    // Trees have leaves mostly above the trunk, so search higher up
    for (let dy = 0; dy <= searchRadius + 3; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                // Skip blocks too far away (use taxicab for horizontal, allow more vertical)
                const horizontalDist = Math.abs(dx) + Math.abs(dz);
                if (horizontalDist > searchRadius) continue;

                const checkPos = logPos.offset(dx, dy, dz);
                const block = bot.blockAt(checkPos);

                if (block && validLeaves.includes(block.name)) {
                    leafCount++;
                    if (leafCount >= minLeaves) {
                        return true; // Found enough matching leaves
                    }
                }
            }
        }
    }

    return false; // Not enough matching leaves found
}

/**
 * Filter trees to only include those that are part of actual forests.
 * Excludes:
 * 1. Logs without leaves attached (not real trees - likely structure logs)
 * 2. Isolated trees (not part of a 3+ tree cluster)
 * 3. Trees near structure blocks (likely part of a building)
 * 4. Trees not near known forest centers (if any)
 */
function filterForestTrees(
    bot: Bot,
    reachableTrees: Block[],
    knownForests: Vec3[],
    log: Logger | null
): Block[] {
    if (reachableTrees.length === 0) return [];

    // Step 1: Filter out logs without leaves attached (not real trees)
    const realTrees = reachableTrees.filter(tree => {
        if (!hasLeavesAttached(bot, tree)) {
            log?.debug({ pos: tree.position.floored().toString(), type: tree.name }, 'Skipping log without leaves (not a real tree)');
            return false;
        }
        return true;
    });

    if (realTrees.length === 0) return [];

    // Step 2: Filter out trees near structures
    const naturalTrees = realTrees.filter(tree => {
        if (isNearStructure(bot, tree.position)) {
            log?.debug({ pos: tree.position.floored().toString() }, 'Skipping tree near structure');
            return false;
        }
        return true;
    });

    if (naturalTrees.length === 0) return [];

    // Step 2: If we have known forests, prioritize trees near them
    if (knownForests.length > 0) {
        const treesNearKnownForest = naturalTrees.filter(tree =>
            knownForests.some(forest => tree.position.distanceTo(forest) <= 50)
        );
        if (treesNearKnownForest.length > 0) {
            return treesNearKnownForest;
        }
    }

    // Step 3: Cluster detection - find trees that are part of groups of 3+
    const clusters = clusterTrees(naturalTrees);
    const forestClusters = clusters.filter(c => c.length >= MIN_FOREST_CLUSTER_SIZE);

    if (forestClusters.length === 0) {
        log?.debug({ treeCount: naturalTrees.length }, 'No forest clusters found (need 3+ trees within 16 blocks)');
        return [];
    }

    // Return all trees from valid forest clusters
    return forestClusters.flat();
}

/**
 * Check if a position is near structure blocks (indicating a building).
 */
function isNearStructure(bot: Bot, pos: Vec3): boolean {
    // Check blocks in a radius around the tree
    for (let dx = -STRUCTURE_CHECK_RADIUS; dx <= STRUCTURE_CHECK_RADIUS; dx++) {
        for (let dy = -2; dy <= 3; dy++) { // Check from 2 below to 3 above
            for (let dz = -STRUCTURE_CHECK_RADIUS; dz <= STRUCTURE_CHECK_RADIUS; dz++) {
                const checkPos = pos.offset(dx, dy, dz);
                const block = bot.blockAt(checkPos);
                if (block && STRUCTURE_BLOCKS.includes(block.name)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Cluster trees by proximity.
 * Trees within FOREST_CLUSTER_RADIUS of each other are in the same cluster.
 */
function clusterTrees(trees: Block[]): Block[][] {
    if (trees.length === 0) return [];

    const visited = new Set<number>();
    const clusters: Block[][] = [];

    for (let i = 0; i < trees.length; i++) {
        if (visited.has(i)) continue;

        // Start a new cluster
        const cluster: Block[] = [];
        const queue = [i];

        while (queue.length > 0) {
            const idx = queue.shift()!;
            if (visited.has(idx)) continue;
            visited.add(idx);

            const tree = trees[idx]!;
            cluster.push(tree);

            // Find all unvisited trees within radius
            for (let j = 0; j < trees.length; j++) {
                if (visited.has(j)) continue;
                if (trees[j]!.position.distanceTo(tree.position) <= FOREST_CLUSTER_RADIUS) {
                    queue.push(j);
                }
            }
        }

        clusters.push(cluster);
    }

    return clusters;
}

/**
 * Get the center point of a cluster of positions.
 */
function getClusterCenter(positions: Vec3[]): Vec3 | null {
    if (positions.length === 0) return null;

    let sumX = 0, sumY = 0, sumZ = 0;
    for (const pos of positions) {
        sumX += pos.x;
        sumY += pos.y;
        sumZ += pos.z;
    }

    return new Vec3(
        Math.floor(sumX / positions.length),
        Math.floor(sumY / positions.length),
        Math.floor(sumZ / positions.length)
    );
}
