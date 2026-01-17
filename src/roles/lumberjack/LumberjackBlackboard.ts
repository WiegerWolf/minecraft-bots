import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat } from '../../shared/VillageChat';
import { LOG_NAMES, LEAF_NAMES, SAPLING_NAMES, type TreeHarvestState } from '../shared/TreeHarvest';
import type { Logger } from '../../shared/logger';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;
}

/**
 * Pending sign write entry - queued when infrastructure is placed
 */
export interface PendingSignWrite {
    type: 'VILLAGE' | 'CRAFT' | 'CHEST';
    pos: Vec3;
}

export interface LumberjackBlackboard {
    // Perception data (refreshed each tick)
    nearbyTrees: Block[];       // Log blocks that could be tree bases
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
    sharedChest: Vec3 | null;
    sharedCraftingTable: Vec3 | null;
    currentTreeHarvest: TreeHarvestState | null;

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
}

export function createLumberjackBlackboard(): LumberjackBlackboard {
    return {
        nearbyTrees: [],
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
    const SEARCH_RADIUS = bb.villageCenter ? 80 : 64; // Stay near village if we have one (~5 chunks)

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
    // COMPUTED DECISIONS
    // ═══════════════════════════════════════════════
    bb.canChop = bb.nearbyTrees.length > 0 || bb.currentTreeHarvest !== null;
    bb.needsToDeposit = bb.logCount >= 32 || bb.inventoryFull;
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
