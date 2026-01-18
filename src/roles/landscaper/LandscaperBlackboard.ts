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
    phase: 'analyzing' | 'sealing_water' | 'digging' | 'filling' | 'finishing' | 'done';
    blocksToRemove: Vec3[];   // Blocks above target level
    waterBlocksToFill: Vec3[]; // Water blocks to fill FIRST (before digging)
    blocksToFill: Vec3[];     // Regular holes to fill (after digging)
    progress: number;
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

    // Determine which known farms need checking
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
