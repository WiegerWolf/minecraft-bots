import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat } from '../../shared/VillageChat';
import { LOG_NAMES, LEAF_NAMES, SAPLING_NAMES, type TreeHarvestState } from '../shared/TreeHarvest';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;
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

    // Exploration memory
    exploredPositions: ExplorationMemory[];

    // Computed booleans
    inventoryFull: boolean;
    canChop: boolean;
    needsToDeposit: boolean;
    hasPendingRequests: boolean;

    // Action tracking
    lastAction: string;
    consecutiveIdleTicks: number;
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

        exploredPositions: [],

        inventoryFull: false,
        canChop: true,
        needsToDeposit: false,
        hasPendingRequests: false,

        lastAction: 'none',
        consecutiveIdleTicks: 0,
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
    const SEARCH_RADIUS = bb.villageCenter ? 50 : 32; // Stay near village if we have one

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

    // Find tree bases (logs with dirt/grass below)
    bb.nearbyTrees = bb.nearbyLogs.filter(log => {
        // Skip logs too high
        if (log.position.y > bot.entity.position.y + 3) return false;

        const below = bot.blockAt(log.position.offset(0, -1, 0));
        return below && ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt'].includes(below.name);
    });

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

    // Find dropped items
    bb.nearbyDrops = Object.values(bot.entities).filter(e =>
        e.name === 'item' && e.position && e.position.distanceTo(pos) < 16
    );

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
