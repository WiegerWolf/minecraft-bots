import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat, TerraformRequest, TradeOffer, ActiveTrade } from '../../shared/VillageChat';
import type { Logger } from '../../shared/logger';
import { type StuckTracker, createStuckTracker } from '../../shared/PathfindingUtils';
import { readAllSignsNear, SIGN_SEARCH_RADIUS } from '../../shared/SignKnowledge';
import { type InventoryItem, getTradeableItems, isWantedByRole } from '../../shared/ItemCategories';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;
}

export interface TerraformTask {
    waterCenter: Vec3;        // The water block at the center of the 9x9 farm
    targetY: number;          // Y level for the farm surface (same as water Y)
    phase: 'analyzing' | 'sealing_water' | 'digging' | 'filling' | 'clearing_path' | 'creating_paths' | 'finishing' | 'done';
    blocksToRemove: Vec3[];   // Blocks above target level
    waterBlocksToFill: Vec3[]; // Water blocks to fill FIRST (before digging)
    blocksToFill: Vec3[];     // Regular holes to fill (after digging)
    pathBlocksToClear: Vec3[]; // Blocks to remove for 1-block path around farm
    pathBlocksToFill: Vec3[];  // Holes to fill in the path
    pathBlocksToConvert: Vec3[]; // Dirt/grass blocks to convert to dirt_path using shovel
    progress: number;
}

// Farm issue types matching TerraformArea's comprehensive checks
export interface FarmIssue {
    type: 'stacked_water' | 'spreading_water' | 'hole' | 'non_farmable' | 'obstacle' | 'path_hole' | 'path_obstacle';
    pos: Vec3;
}

// Cached farm scan result
export interface FarmScanResult {
    farmPos: Vec3;
    issues: FarmIssue[];
    scanTime: number;
}

export interface LandscaperBlackboard {
    // Perception data (refreshed each tick)
    nearbyDrops: any[];
    nearbyChests: Block[];
    nearbyCraftingTables: Block[];

    // Inventory summary
    hasShovel: boolean;
    hasPickaxe: boolean;
    dirtCount: number;
    cobblestoneCount: number;
    logCount: number;
    plankCount: number;
    stickCount: number;
    slabCount: number;  // Wooden slabs for pathfinding scaffolding
    emptySlots: number;

    // Strategic state (persists across ticks)
    villageCenter: Vec3 | null;
    sharedChest: Vec3 | null;
    sharedCraftingTable: Vec3 | null;
    currentTerraformTask: TerraformTask | null;

    // Village communication (set by role)
    villageChat: VillageChat | null;

    // Logger (set by role)
    log: Logger | null;

    // Pathfinding stuck detection (for hole escape)
    stuckTracker: StuckTracker;

    // Exploration memory
    exploredPositions: ExplorationMemory[];

    // Unreachable items tracking (entity id -> expiry timestamp)
    unreachableDrops: Map<number, number>;

    // Computed booleans
    inventoryFull: boolean;
    hasPendingTerraformRequest: boolean;
    canTerraform: boolean;
    needsTools: boolean;
    needsToDeposit: boolean;

    // Action tracking
    lastAction: string;
    consecutiveIdleTicks: number;

    // Sign-based farm knowledge (proactive terraforming)
    spawnPosition: Vec3 | null;              // Where bot spawned (for sign reading)
    hasStudiedSigns: boolean;                // Has bot read signs near spawn
    knownFarms: Vec3[];                      // Farm locations from FARM signs
    lastFarmCheckTimes: Map<string, number>; // Farm pos key -> last check timestamp
    farmsNeedingCheck: Vec3[];               // Farms that should be checked for terraform needs

    // Issue-based farm maintenance (replaces time-based)
    farmIssuesCache: Map<string, FarmScanResult>; // Farm pos key -> scan result
    farmsWithIssues: Vec3[];                      // Farms that currently have detected issues

    // Curiosity - wild sign reading
    unknownSigns: Vec3[];                 // Signs spotted but not yet read
    readSignPositions: Set<string>;       // Sign positions we've read (stringified: "x,y,z")

    // ═══════════════════════════════════════════════════════════════
    // TRADE STATE
    // ═══════════════════════════════════════════════════════════════
    tradeableItems: InventoryItem[];            // Items we can offer for trade
    tradeableItemCount: number;                 // Total count of tradeable items
    pendingTradeOffers: TradeOffer[];           // Active offers from other bots we might want
    activeTrade: ActiveTrade | null;            // Current trade state (if any)
    lastOfferTime: number;                      // When we last broadcast an offer (cooldown)
}

export function createLandscaperBlackboard(): LandscaperBlackboard {
    return {
        nearbyDrops: [],
        nearbyChests: [],
        nearbyCraftingTables: [],

        hasShovel: false,
        hasPickaxe: false,
        dirtCount: 0,
        cobblestoneCount: 0,
        logCount: 0,
        plankCount: 0,
        stickCount: 0,
        slabCount: 0,
        emptySlots: 36,

        villageCenter: null,
        sharedChest: null,
        sharedCraftingTable: null,
        currentTerraformTask: null,

        villageChat: null,
        log: null,

        stuckTracker: createStuckTracker(),

        exploredPositions: [],
        unreachableDrops: new Map(),

        inventoryFull: false,
        hasPendingTerraformRequest: false,
        canTerraform: false,
        needsTools: false,
        needsToDeposit: false,

        lastAction: 'none',
        consecutiveIdleTicks: 0,

        // Sign-based farm knowledge
        spawnPosition: null,
        hasStudiedSigns: false,
        knownFarms: [],
        lastFarmCheckTimes: new Map(),
        farmsNeedingCheck: [],

        // Issue-based farm maintenance
        farmIssuesCache: new Map(),
        farmsWithIssues: [],

        // Curiosity - wild sign reading
        unknownSigns: [],
        readSignPositions: new Set(),

        // Trade state
        tradeableItems: [],
        tradeableItemCount: 0,
        pendingTradeOffers: [],
        activeTrade: null,
        lastOfferTime: 0,
    };
}

export async function updateLandscaperBlackboard(bot: Bot, bb: LandscaperBlackboard): Promise<void> {
    const pos = bot.entity.position;
    const inv = bot.inventory.items();

    // ═══════════════════════════════════════════════
    // INVENTORY ANALYSIS
    // ═══════════════════════════════════════════════
    bb.hasShovel = inv.some(i => i.name.includes('shovel'));
    bb.hasPickaxe = inv.some(i => i.name.includes('pickaxe'));
    bb.emptySlots = bot.inventory.emptySlotCount();
    bb.inventoryFull = bb.emptySlots < 3;

    bb.dirtCount = inv.filter(i => i.name === 'dirt').reduce((s, i) => s + i.count, 0);
    bb.cobblestoneCount = inv.filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);
    bb.logCount = inv.filter(i => i.name.includes('_log')).reduce((s, i) => s + i.count, 0);
    bb.plankCount = inv.filter(i => i.name.endsWith('_planks')).reduce((s, i) => s + i.count, 0);
    bb.stickCount = inv.filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0);
    bb.slabCount = inv.filter(i => i.name.endsWith('_slab')).reduce((s, i) => s + i.count, 0);

    // ═══════════════════════════════════════════════
    // VILLAGE STATE (from chat)
    // ═══════════════════════════════════════════════
    if (bb.villageChat) {
        bb.villageCenter = bb.villageChat.getVillageCenter();
        bb.sharedChest = bb.villageChat.getSharedChest();
        bb.sharedCraftingTable = bb.villageChat.getSharedCraftingTable();

        // Check for pending terraform requests (not yet claimed)
        const pendingRequests = bb.villageChat.getPendingTerraformRequests();
        const allRequests = bb.villageChat.getAllTerraformRequests?.() || [];

        // Auto-release stale claims: if we claimed something but have no active task, release it
        const myUsername = bot.username;
        for (const req of allRequests) {
            if (req.status === 'claimed' && req.claimedBy === myUsername && !bb.currentTerraformTask) {
                bb.log?.debug({ pos: req.position.floored().toString() }, 'Releasing stale claim');
                bb.villageChat.releaseTerraformClaim(req.position);
            }
        }

        // Re-fetch after potential release
        const updatedPending = bb.villageChat.getPendingTerraformRequests();
        // Consider it "pending" if there's a pending request OR we have an active task
        bb.hasPendingTerraformRequest = updatedPending.length > 0 || bb.currentTerraformTask !== null;
    }

    // ═══════════════════════════════════════════════
    // WORLD PERCEPTION
    // ═══════════════════════════════════════════════
    const searchCenter = bb.villageCenter || pos;
    const SEARCH_RADIUS = bb.villageCenter ? 80 : 64;

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
    // SPAWN POSITION (set once on first update)
    // ═══════════════════════════════════════════════
    if (!bb.spawnPosition) {
        bb.spawnPosition = pos.clone();
        bb.log?.debug({ pos: bb.spawnPosition.floored().toString() }, 'Set spawn position');
    }

    // ═══════════════════════════════════════════════
    // FARM KNOWLEDGE (from signs - update farms needing check)
    // ═══════════════════════════════════════════════
    const FARM_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes between checks of same farm
    // (reuses 'now' from above)

    // Determine which known farms need checking (time-based for terraform checks)
    bb.farmsNeedingCheck = bb.knownFarms.filter(farmPos => {
        const key = `${Math.floor(farmPos.x)},${Math.floor(farmPos.y)},${Math.floor(farmPos.z)}`;
        const lastCheck = bb.lastFarmCheckTimes.get(key) || 0;

        // Don't check if we checked recently
        if (now - lastCheck < FARM_CHECK_INTERVAL) return false;

        // Don't check if there's already a pending request for this farm
        if (bb.villageChat) {
            const allRequests = bb.villageChat.getAllTerraformRequests?.() || [];
            const hasPendingRequest = allRequests.some(req =>
                req.position.distanceTo(farmPos) < 5 &&
                (req.status === 'pending' || req.status === 'claimed')
            );
            if (hasPendingRequest) return false;
        }

        return true;
    });

    // ═══════════════════════════════════════════════
    // ISSUE-BASED FARM MAINTENANCE
    // Scan nearby farms for actual issues (not time-based)
    // ═══════════════════════════════════════════════
    updateFarmIssuesCache(bot, bb);

    // ═══════════════════════════════════════════════
    // COMPUTED DECISIONS
    // ═══════════════════════════════════════════════
    bb.needsTools = !bb.hasShovel || !bb.hasPickaxe;
    bb.canTerraform = (bb.hasShovel || bb.hasPickaxe) && bb.hasPendingTerraformRequest;
    bb.needsToDeposit = bb.dirtCount >= 64 || bb.cobblestoneCount >= 64 || bb.inventoryFull;

    // ═══════════════════════════════════════════════
    // TRADE STATE
    // ═══════════════════════════════════════════════
    // Convert inventory to InventoryItem format
    const invItems: InventoryItem[] = inv.map(i => ({ name: i.name, count: i.count }));

    // Get items we can trade (unwanted + helpful items)
    bb.tradeableItems = getTradeableItems(invItems, 'landscaper');
    bb.tradeableItemCount = bb.tradeableItems.reduce((sum, item) => sum + item.count, 0);

    // Get trade state from villageChat
    if (bb.villageChat) {
        bb.pendingTradeOffers = bb.villageChat.getActiveOffers()
            .filter(o => isWantedByRole(o.item, 'landscaper')); // Only offers for items we want
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

export function recordExploredPosition(bb: LandscaperBlackboard, pos: Vec3, reason: string = 'visited'): void {
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

export function cleanupExplorationMemory(bb: LandscaperBlackboard): void {
    const now = Date.now();
    bb.exploredPositions = bb.exploredPositions.filter(
        e => now - e.timestamp < EXPLORATION_MEMORY_TTL
    );
}

export function isNearExplored(bb: LandscaperBlackboard, pos: Vec3, radius: number = 16): boolean {
    return bb.exploredPositions.some(
        e => e.position.distanceTo(pos) < radius
    );
}

export function getExplorationScore(bb: LandscaperBlackboard, pos: Vec3): number {
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
// COMPREHENSIVE FARM ISSUE DETECTION
// Based on TerraformArea's farm structure requirements:
// - 9x9 dirt/farmland area with water in center
// - No obstacles above the farm (2 block clearance)
// - 1-block walkable path around the farm (at radius 5)
// - Solid support below the farm surface
// ═══════════════════════════════════════════════

// Blocks that are good for farm surface
const FARMABLE_BLOCKS = ['dirt', 'grass_block', 'farmland'];

// Blocks that block walking/farming
const OBSTACLE_BLOCKS = ['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'sandstone', 'gravel', 'sand'];

/**
 * Scan a farm for ALL issues - comprehensive check based on TerraformArea logic.
 * Returns a list of issues that need to be fixed to restore the farm to perfect condition.
 */
export function scanFarmForAllIssues(bot: Bot, farmCenter: Vec3): FarmIssue[] {
    const issues: FarmIssue[] = [];
    const radius = 4; // 9x9 area
    const pathRadius = 5; // Path around the farm
    const centerX = Math.floor(farmCenter.x);
    const targetY = Math.floor(farmCenter.y);
    const centerZ = Math.floor(farmCenter.z);

    // ═══════════════════════════════════════════════
    // SCAN THE 9x9 FARM AREA
    // ═══════════════════════════════════════════════
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            const x = centerX + dx;
            const z = centerZ + dz;
            const isCenter = dx === 0 && dz === 0;

            const topPos = new Vec3(x, targetY, z);
            const bottomPos = new Vec3(x, targetY - 1, z);
            const topBlock = bot.blockAt(topPos);
            const bottomBlock = bot.blockAt(bottomPos);

            // === CENTER WATER BLOCK ===
            if (isCenter) {
                // Center should have water on top
                if (topBlock && (topBlock.name === 'water' || topBlock.name === 'flowing_water')) {
                    // But should NOT have water below (stacked water)
                    if (bottomBlock && (bottomBlock.name === 'water' || bottomBlock.name === 'flowing_water')) {
                        issues.push({ type: 'stacked_water', pos: bottomPos.clone() });
                    }
                }
                continue; // Don't check center for other issues
            }

            // === SURFACE LAYER (targetY) ===
            if (topBlock) {
                // Water spreading into farm area
                if (topBlock.name === 'water' || topBlock.name === 'flowing_water') {
                    issues.push({ type: 'spreading_water', pos: topPos.clone() });
                }
                // Hole in farm surface
                else if (topBlock.name === 'air') {
                    issues.push({ type: 'hole', pos: topPos.clone() });
                }
                // Non-farmable block (stone, gravel, etc.) - needs replacement
                else if (!FARMABLE_BLOCKS.includes(topBlock.name)) {
                    issues.push({ type: 'non_farmable', pos: topPos.clone() });
                }
            } else {
                // No block at all (unloaded chunk?)
                issues.push({ type: 'hole', pos: topPos.clone() });
            }

            // === SUPPORT LAYER (targetY - 1) ===
            if (bottomBlock) {
                if (bottomBlock.name === 'water' || bottomBlock.name === 'flowing_water') {
                    issues.push({ type: 'stacked_water', pos: bottomPos.clone() });
                } else if (bottomBlock.name === 'air') {
                    issues.push({ type: 'hole', pos: bottomPos.clone() });
                }
            }

            // === CLEARANCE ABOVE (2 blocks for walking/farming) ===
            for (let y = targetY + 1; y <= targetY + 2; y++) {
                const abovePos = new Vec3(x, y, z);
                const aboveBlock = bot.blockAt(abovePos);
                if (!aboveBlock || aboveBlock.name === 'air') continue;

                // Solid blocks that need removal
                if (aboveBlock.boundingBox === 'block' ||
                    aboveBlock.name.includes('_log') || aboveBlock.name.includes('leaves') ||
                    OBSTACLE_BLOCKS.includes(aboveBlock.name)) {
                    issues.push({ type: 'obstacle', pos: abovePos.clone() });
                }
            }
        }
    }

    // ═══════════════════════════════════════════════
    // SCAN THE PATH RING (1-block walkable path at radius 5)
    // ═══════════════════════════════════════════════
    for (let dx = -pathRadius; dx <= pathRadius; dx++) {
        for (let dz = -pathRadius; dz <= pathRadius; dz++) {
            // Only include blocks on the outer ring
            const isOnPathRing = Math.abs(dx) === pathRadius || Math.abs(dz) === pathRadius;
            if (!isOnPathRing) continue;

            const x = centerX + dx;
            const z = centerZ + dz;
            const pathPos = new Vec3(x, targetY, z);
            const pathBlock = bot.blockAt(pathPos);
            const belowPath = new Vec3(x, targetY - 1, z);
            const belowBlock = bot.blockAt(belowPath);

            // === PATH SURFACE ===
            if (!pathBlock || pathBlock.name === 'air') {
                issues.push({ type: 'path_hole', pos: pathPos.clone() });
            } else if (pathBlock.name === 'water' || pathBlock.name === 'flowing_water') {
                issues.push({ type: 'path_hole', pos: pathPos.clone() });
            }

            // === PATH SUPPORT ===
            if (belowBlock && (belowBlock.name === 'air' || belowBlock.name === 'water' || belowBlock.name === 'flowing_water')) {
                issues.push({ type: 'path_hole', pos: belowPath.clone() });
            }

            // === PATH CLEARANCE (2 blocks for walking) ===
            for (let y = targetY + 1; y <= targetY + 2; y++) {
                const abovePos = new Vec3(x, y, z);
                const aboveBlock = bot.blockAt(abovePos);
                if (!aboveBlock || aboveBlock.name === 'air') continue;

                // Solid obstacles blocking the path
                if (aboveBlock.boundingBox === 'block' ||
                    aboveBlock.name.includes('_log') || aboveBlock.name.includes('leaves')) {
                    issues.push({ type: 'path_obstacle', pos: abovePos.clone() });
                }
            }
        }
    }

    // Sort: water issues first (critical), then obstacles (dig), then holes (fill)
    // Also sort by Y (lower first for bottom-up filling, higher first for top-down digging)
    issues.sort((a, b) => {
        const typePriority: Record<FarmIssue['type'], number> = {
            'stacked_water': 0,
            'spreading_water': 1,
            'obstacle': 2,
            'path_obstacle': 3,
            'non_farmable': 4,
            'hole': 5,
            'path_hole': 6,
        };
        const typeCompare = typePriority[a.type] - typePriority[b.type];
        if (typeCompare !== 0) return typeCompare;

        // For digging (obstacles), go top-down
        if (a.type === 'obstacle' || a.type === 'path_obstacle' || a.type === 'non_farmable') {
            return b.pos.y - a.pos.y;
        }
        // For filling (holes, water), go bottom-up
        return a.pos.y - b.pos.y;
    });

    return issues;
}

/**
 * Check if a farm needs maintenance by scanning for actual issues.
 * Returns true if there are any issues detected.
 */
export function farmNeedsMaintenance(bot: Bot, farmPos: Vec3): boolean {
    const issues = scanFarmForAllIssues(bot, farmPos);
    return issues.length > 0;
}

/**
 * Update farm issues cache for farms that are close enough to scan.
 * Only scans farms within chunk loading distance.
 */
export function updateFarmIssuesCache(bot: Bot, bb: LandscaperBlackboard): void {
    const pos = bot.entity.position;
    const SCAN_DISTANCE = 48; // Only scan farms we can see
    const CACHE_TTL = 30 * 1000; // Re-scan every 30 seconds
    const now = Date.now();

    bb.farmsWithIssues = [];

    for (const farmPos of bb.knownFarms) {
        const dist = pos.distanceTo(farmPos);
        const farmKey = `${Math.floor(farmPos.x)},${Math.floor(farmPos.y)},${Math.floor(farmPos.z)}`;

        // Only scan farms within range
        if (dist > SCAN_DISTANCE) {
            // Keep old cache entry if we have one
            const cached = bb.farmIssuesCache.get(farmKey);
            if (cached && cached.issues.length > 0) {
                bb.farmsWithIssues.push(farmPos);
            }
            continue;
        }

        // Check if we need to re-scan
        const cached = bb.farmIssuesCache.get(farmKey);
        if (cached && (now - cached.scanTime) < CACHE_TTL) {
            // Use cached result
            if (cached.issues.length > 0) {
                bb.farmsWithIssues.push(farmPos);
            }
            continue;
        }

        // Scan the farm
        const issues = scanFarmForAllIssues(bot, farmPos);
        bb.farmIssuesCache.set(farmKey, {
            farmPos: farmPos.clone(),
            issues,
            scanTime: now,
        });

        if (issues.length > 0) {
            bb.farmsWithIssues.push(farmPos);
            bb.log?.debug(
                { pos: farmPos.floored().toString(), issueCount: issues.length },
                'Farm has issues'
            );
        }
    }
}
