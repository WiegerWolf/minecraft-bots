import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';

export interface FarmingBlackboard {
    // Perception data (refreshed each tick)
    nearbyWater: Block[];
    nearbyFarmland: Block[];
    nearbyMatureCrops: Block[];
    nearbyGrass: Block[];
    nearbyDrops: any[];
    nearbyChests: Block[];

    // Inventory summary
    hasHoe: boolean;
    hasSword: boolean;
    seedCount: number;
    produceCount: number;
    emptySlots: number;
    logCount: number;
    plankCount: number;
    stickCount: number;

    // Strategic state (persists across ticks)
    farmCenter: Vec3 | null;
    lastAction: string;
    consecutiveIdleTicks: number;

    // Computed booleans for easy decision making
    canTill: boolean;
    canPlant: boolean;
    canHarvest: boolean;
    needsTools: boolean;
    needsSeeds: boolean;
    inventoryFull: boolean;
}

export function createBlackboard(): FarmingBlackboard {
    return {
        nearbyWater: [],
        nearbyFarmland: [],
        nearbyMatureCrops: [],
        nearbyGrass: [],
        nearbyDrops: [],
        nearbyChests: [],

        hasHoe: false,
        hasSword: false,
        seedCount: 0,
        produceCount: 0,
        emptySlots: 36,
        logCount: 0,
        plankCount: 0,
        stickCount: 0,

        farmCenter: null,
        lastAction: 'none',
        consecutiveIdleTicks: 0,

        canTill: false,
        canPlant: false,
        canHarvest: false,
        needsTools: false,
        needsSeeds: false,
        inventoryFull: false,
    };
}

export function updateBlackboard(bot: Bot, bb: FarmingBlackboard): void {
    const pos = bot.entity.position;
    const inv = bot.inventory.items();

    // ═══════════════════════════════════════════════
    // INVENTORY ANALYSIS (cheap, do first)
    // ═══════════════════════════════════════════════
    bb.hasHoe = inv.some(i => i.name.includes('hoe'));
    bb.hasSword = inv.some(i => i.name.includes('sword'));
    bb.emptySlots = bot.inventory.emptySlotCount();
    bb.inventoryFull = bb.emptySlots < 3;

    bb.seedCount = inv
        .filter(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name))
        .reduce((sum, item) => sum + item.count, 0);

    bb.produceCount = inv
        .filter(i => ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice'].includes(i.name))
        .reduce((sum, item) => sum + item.count, 0);

    bb.logCount = inv.filter(i => i.name.includes('_log')).reduce((s, i) => s + i.count, 0);
    bb.plankCount = inv.filter(i => i.name.endsWith('_planks')).reduce((s, i) => s + i.count, 0);
    bb.stickCount = inv.filter(i => i.name === 'stick').reduce((s, i) => s + i.count, 0);

    // ═══════════════════════════════════════════════
    // WORLD PERCEPTION (expensive, cache results)
    // ═══════════════════════════════════════════════
    const searchCenter = bb.farmCenter || pos;
    const SEARCH_RADIUS = 32;

    // Find water sources
    bb.nearbyWater = bot.findBlocks({
        point: searchCenter,
        maxDistance: SEARCH_RADIUS,
        count: 10,
        matching: b => {
            // FIX: Add null check for unloaded chunks
            if (!b || !b.position) return false;
            return b.name === 'water' || b.name === 'flowing_water';
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Ensure farm center water is included (chunks may be unloaded when bot is far away)
    if (bb.farmCenter && bb.nearbyWater.length === 0) {
        const farmCenterBlock = bot.blockAt(bb.farmCenter);
        if (farmCenterBlock && (farmCenterBlock.name === 'water' || farmCenterBlock.name === 'flowing_water')) {
            bb.nearbyWater.push(farmCenterBlock);
        }
    }

    // Find farmland - only hydrated blocks with adequate light
    bb.nearbyFarmland = bot.findBlocks({
        point: searchCenter,
        maxDistance: 16, // Reduced from 32 - focus on nearby farmland
        count: 50,
        matching: b => {
            // FIX: Add comprehensive null checks
            if (!b || !b.position || !b.name) return false;
            if (b.name !== 'farmland') return false;

            const above = bot.blockAt(b.position.offset(0, 1, 0));
            return above !== null && above.name === 'air';
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => {
        if (!b) return false;
        // Only include farmland within 4 blocks of water (hydration range)
        if (!isWithinHydrationRange(b.position, bb.nearbyWater)) return false;
        // Only include farmland with adequate light for crop growth
        if (!hasAdequateLight(bot, b.position)) return false;
        return true;
    });

    // Find mature crops
    bb.nearbyMatureCrops = bot.findBlocks({
        point: searchCenter,
        maxDistance: SEARCH_RADIUS,
        count: 20,
        matching: b => {
            // FIX: Add null checks
            if (!b || !b.position || !b.name) return false;
            return isMatureCrop(b);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Find grass (for seeds) - expanded list for different MC versions
    const grassNames = ['short_grass', 'tall_grass', 'grass', 'fern', 'large_fern'];
    bb.nearbyGrass = bot.findBlocks({
        point: pos, // Search around bot, not farm center
        maxDistance: 48,
        count: 10,
        matching: b => {
            if (!b || !b.position || !b.name) return false;
            return grassNames.includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Find dropped items (entities, not blocks - already safe)
    bb.nearbyDrops = Object.values(bot.entities).filter(e =>
        e.name === 'item' && e.position && e.position.distanceTo(pos) < 16
    );

    // Find chests
    bb.nearbyChests = bot.findBlocks({
        point: pos,
        maxDistance: 32,
        count: 5,
        matching: b => {
            // FIX: Add null checks
            if (!b || !b.position || !b.name) return false;
            return ['chest', 'barrel'].includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // ═══════════════════════════════════════════════
    // COMPUTED DECISIONS
    // ═══════════════════════════════════════════════
    bb.needsTools = !bb.hasHoe;
    bb.needsSeeds = bb.seedCount < 3;
    bb.canHarvest = bb.nearbyMatureCrops.length > 0 && !bb.inventoryFull;
    bb.canPlant = bb.hasHoe && bb.seedCount > 0 && bb.nearbyFarmland.length > 0;
    bb.canTill = bb.hasHoe && bb.seedCount > 0 && bb.nearbyWater.length > 0;

    // ═══════════════════════════════════════════════
    // FARM CENTER MANAGEMENT
    // ═══════════════════════════════════════════════
    if (!bb.farmCenter && bb.nearbyWater.length > 0) {
        // Find water with best farming potential
        const best = bb.nearbyWater
            .filter(w => w.position.y > pos.y - 10 && w.position.y < pos.y + 10) // Sane Y level!
            .sort((a, b) => {
                const scoreA = countTillableAround(bot, a.position);
                const scoreB = countTillableAround(bot, b.position);
                return scoreB - scoreA;
            })[0];

        if (best) {
            bb.farmCenter = best.position.clone();
            console.log(`[Blackboard] Established farm center at ${bb.farmCenter}`);
        }
    }

    // Validate existing farm center
    if (bb.farmCenter) {
        const block = bot.blockAt(bb.farmCenter);
        if (!block || (block.name !== 'water' && block.name !== 'flowing_water')) {
            console.log(`[Blackboard] Farm center invalid, clearing...`);
            bb.farmCenter = null;
        }
    }
}

function isMatureCrop(block: Block): boolean {
    // FIX: Add safety checks
    if (!block || !block.name) return false;

    const crops: Record<string, number> = {
        'wheat': 7, 'carrots': 7, 'potatoes': 7, 'beetroots': 3
    };
    const maxAge = crops[block.name];
    if (maxAge === undefined) return false;

    const props = block.getProperties();
    return props.age !== undefined && parseInt(String(props.age)) >= maxAge;
}

function countTillableAround(bot: Bot, center: Vec3): number {
    let count = 0;
    for (let x = -4; x <= 4; x++) {
        for (let z = -4; z <= 4; z++) {
            const block = bot.blockAt(center.offset(x, 0, z));
            // FIX: Add null checks
            if (!block || !block.name || !block.position) continue;

            if (['grass_block', 'dirt'].includes(block.name)) {
                const above = bot.blockAt(block.position.offset(0, 1, 0));
                if (above && above.name === 'air') count++;
            }
        }
    }
    return count;
}

// Check if position is within 4 blocks of any water (Minecraft hydration range)
function isWithinHydrationRange(pos: Vec3, waterBlocks: Block[]): boolean {
    for (const water of waterBlocks) {
        const dx = Math.abs(pos.x - water.position.x);
        const dz = Math.abs(pos.z - water.position.z);
        const dy = Math.abs(pos.y - water.position.y);
        if (dx <= 4 && dz <= 4 && dy <= 1) return true;
    }
    return false;
}

// Check if block above has sufficient light (crops need ≥9)
function hasAdequateLight(bot: Bot, farmlandPos: Vec3): boolean {
    const above = bot.blockAt(farmlandPos.offset(0, 1, 0));
    if (!above) return false;
    const light = Math.max(above.skyLight ?? 0, above.light ?? 0);
    return light >= 9;
}