import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat, TerraformRequest } from '../../shared/VillageChat';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;
}

export interface TerraformTask {
    waterPos: Vec3;
    targetY: number;
    phase: 'analyzing' | 'digging' | 'filling' | 'finishing' | 'done';
    blocksToRemove: Vec3[];   // Blocks above target level
    blocksToFill: Vec3[];     // Holes below target level
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
    emptySlots: number;

    // Strategic state (persists across ticks)
    villageCenter: Vec3 | null;
    sharedChest: Vec3 | null;
    sharedCraftingTable: Vec3 | null;
    currentTerraformTask: TerraformTask | null;

    // Village communication (set by role)
    villageChat: VillageChat | null;

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
        emptySlots: 36,

        villageCenter: null,
        sharedChest: null,
        sharedCraftingTable: null,
        currentTerraformTask: null,

        villageChat: null,

        exploredPositions: [],
        unreachableDrops: new Map(),

        inventoryFull: false,
        hasPendingTerraformRequest: false,
        canTerraform: false,
        needsTools: false,
        needsToDeposit: false,

        lastAction: 'none',
        consecutiveIdleTicks: 0,
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
        // Consider it "pending" if there's a pending request OR we have an active task
        bb.hasPendingTerraformRequest = pendingRequests.length > 0 || bb.currentTerraformTask !== null;

        // Debug log when there are any requests
        if (allRequests.length > 0) {
            const statuses = allRequests.map(r => `${r.status}@${r.position.floored()}`).join(', ');
            console.log(`[Landscaper] Terraform: pending=${pendingRequests.length}, all=${allRequests.length} [${statuses}], activeTask=${!!bb.currentTerraformTask}`);
        }
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
    // COMPUTED DECISIONS
    // ═══════════════════════════════════════════════
    bb.needsTools = !bb.hasShovel || !bb.hasPickaxe;
    bb.canTerraform = (bb.hasShovel || bb.hasPickaxe) && bb.hasPendingTerraformRequest;
    bb.needsToDeposit = bb.dirtCount >= 64 || bb.cobblestoneCount >= 64 || bb.inventoryFull;
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
