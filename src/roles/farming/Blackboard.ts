import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat } from '../../shared/VillageChat';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;  // Why this location was recorded (e.g., 'visited', 'bad_water')
}

export interface TreeHarvestState {
    basePos: Vec3;
    logType: string;
    phase: 'chopping' | 'clearing_leaves' | 'replanting' | 'done';
}

export interface FarmingBlackboard {
    // Perception data (refreshed each tick)
    nearbyWater: Block[];
    nearbyFarmland: Block[];
    nearbyMatureCrops: Block[];
    nearbyGrass: Block[];
    nearbyDrops: any[];
    nearbyChests: Block[];
    nearbyCraftingTables: Block[];

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
    farmChest: Vec3 | null;  // POI: chest for storing harvest (deprecated, use sharedChest)
    sharedChest: Vec3 | null;  // Village shared chest (for all bots)
    sharedCraftingTable: Vec3 | null;  // Village shared crafting table (for all bots)
    lastAction: string;
    consecutiveIdleTicks: number;

    // Exploration memory (persists across ticks)
    exploredPositions: ExplorationMemory[];  // Recently visited positions
    badWaterPositions: ExplorationMemory[];  // Cave water locations to avoid

    // Unreachable items tracking (entity id -> expiry timestamp)
    unreachableDrops: Map<number, number>;

    // Tree harvesting state (persists across ticks)
    currentTreeHarvest: TreeHarvestState | null;

    // Village communication (set by role)
    villageChat: VillageChat | null;

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
        nearbyCraftingTables: [],

        hasHoe: false,
        hasSword: false,
        seedCount: 0,
        produceCount: 0,
        emptySlots: 36,
        logCount: 0,
        plankCount: 0,
        stickCount: 0,

        farmCenter: null,
        farmChest: null,
        sharedChest: null,
        sharedCraftingTable: null,
        lastAction: 'none',
        consecutiveIdleTicks: 0,

        exploredPositions: [],
        badWaterPositions: [],
        unreachableDrops: new Map(),

        currentTreeHarvest: null,

        villageChat: null,

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
    const SEARCH_RADIUS = 64; // ~4 chunks for better navigation
    // Search further for water when we don't have a farm yet
    const WATER_SEARCH_RADIUS = bb.farmCenter ? SEARCH_RADIUS : 80;

    // Find water sources
    bb.nearbyWater = bot.findBlocks({
        point: searchCenter,
        maxDistance: WATER_SEARCH_RADIUS,
        count: 20,
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

    // Find farmland - filter by Y-level if we have a farm center
    // A 9x9 farm = 80 farmland blocks, so search for more than that
    const farmCenterY = bb.farmCenter?.y ?? pos.y;
    const rawFarmland = bot.findBlocks({
        point: searchCenter,
        maxDistance: 32,
        count: 100,  // 9x9 farm = 80 blocks, leave room for larger farms
        matching: b => {
            if (!b || !b.name) return false;
            return b.name === 'farmland';
        }
    });

    bb.nearbyFarmland = rawFarmland.map(p => bot.blockAt(p)).filter((b): b is Block => {
        if (!b) return false;
        // Filter by Y-level: farmland should be at same Y as water OR one above (for trench farms)
        // NOT below water (that would be underwater!)
        if (bb.farmCenter) {
            const yDiff = b.position.y - farmCenterY;
            if (yDiff < 0 || yDiff > 1) return false;  // Only accept Y=0 or Y=+1 relative to water
        }
        // Check if there's air above (can plant)
        const above = bot.blockAt(b.position.offset(0, 1, 0));
        if (!above || above.name !== 'air') return false;
        return true;
    });

    // Debug: log farmland stats
    if (rawFarmland.length > 0) {
        const correctYBlocks = rawFarmland.filter(p => {
            const yDiff = p.y - farmCenterY;
            return yDiff >= 0 && yDiff <= 1;
        });

        // Count how many have air above
        let withAir = 0;
        let withCrops = 0;
        for (const p of correctYBlocks) {
            const block = bot.blockAt(p);
            const above = block ? bot.blockAt(block.position.offset(0, 1, 0)) : null;
            if (above?.name === 'air') withAir++;
            else if (above?.name === 'wheat' || above?.name === 'carrots' || above?.name === 'potatoes' || above?.name === 'beetroots') withCrops++;
        }

        if (bb.nearbyFarmland.length === 0) {
            console.log(`[Blackboard] Found ${rawFarmland.length} farmland (${correctYBlocks.length} at correct Y): ${withAir} empty, ${withCrops} planted`);
        }
    }

    // Find mature crops - search for ALL crops first, then filter for mature ones
    const cropNames = ['wheat', 'carrots', 'potatoes', 'beetroots'];
    const allCrops = bot.findBlocks({
        point: searchCenter,
        maxDistance: SEARCH_RADIUS,
        count: 100,
        matching: b => {
            if (!b || !b.name) return false;
            return cropNames.includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    bb.nearbyMatureCrops = allCrops.filter(b => isMatureCrop(b));

    // Debug: show crop maturity status
    if (allCrops.length > 0 && bb.nearbyMatureCrops.length === 0) {
        const sample = allCrops.slice(0, 3).map(b => {
            const props = b.getProperties();
            return `${b.name}:age${props.age ?? '?'}`;
        }).join(', ');
        console.log(`[Blackboard] Found ${allCrops.length} crops, ${bb.nearbyMatureCrops.length} mature: [${sample}]`);
    }

    // Find grass (for seeds) - expanded list for different MC versions
    const grassNames = ['short_grass', 'tall_grass', 'grass', 'fern', 'large_fern'];
    bb.nearbyGrass = bot.findBlocks({
        point: pos, // Search around bot, not farm center
        maxDistance: 64, // Increased range for grass
        count: 10,
        matching: b => {
            if (!b || !b.position || !b.name) return false;
            return grassNames.includes(b.name);
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
        const itemPos = e.position;
        const blockBelow = bot.blockAt(itemPos.offset(0, -0.5, 0));

        if (!blockBelow) return true; // Can't check, assume reachable

        // Items on leaves or in water are likely unreachable
        if (blockBelow.name.includes('leaves') || blockBelow.name === 'water') {
            if (Math.abs(itemPos.y - pos.y) <= 2) {
                return true; // Close enough vertically
            }
            return false;
        }

        // Items too high above the bot are unreachable
        if (itemPos.y > pos.y + 5) return false;

        return true;
    });

    // Find chests
    bb.nearbyChests = bot.findBlocks({
        point: pos,
        maxDistance: 64, // Increased range for navigation
        count: 5,
        matching: b => {
            // FIX: Add null checks
            if (!b || !b.position || !b.name) return false;
            return ['chest', 'barrel'].includes(b.name);
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Find crafting tables
    bb.nearbyCraftingTables = bot.findBlocks({
        point: pos,
        maxDistance: 64, // Increased range for navigation
        count: 3,
        matching: b => {
            if (!b || !b.position || !b.name) return false;
            return b.name === 'crafting_table';
        }
    }).map(p => bot.blockAt(p)).filter((b): b is Block => b !== null);

    // Get shared village state from chat
    if (bb.villageChat) {
        bb.sharedChest = bb.villageChat.getSharedChest();
        bb.sharedCraftingTable = bb.villageChat.getSharedCraftingTable();
    }

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
        // Find water with best farming potential - must be under clear sky (not in caves!)
        // Use radius 0 - just check the water block itself. Shorelines with trees nearby are OK!
        const candidates = bb.nearbyWater
            .filter(w => w.position.y > pos.y - 10 && w.position.y < pos.y + 10) // Sane Y level!
            .filter(w => hasClearSky(bot, w.position, 0)); // Just check water block isn't underground

        // Sort by tillable ground, but any amount is OK for early game
        const best = candidates.sort((a, b) => {
            const scoreA = countTillableAround(bot, a.position);
            const scoreB = countTillableAround(bot, b.position);
            return scoreB - scoreA;
        })[0];

        if (best) {
            const tillable = countTillableAround(bot, best.position);
            bb.farmCenter = best.position.clone();
            console.log(`[Blackboard] Established farm center at ${bb.farmCenter} (${tillable} tillable blocks nearby)`);
        } else if (bb.nearbyWater.length > 0) {
            console.log(`[Blackboard] Found ${bb.nearbyWater.length} water sources but none under clear sky`);
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
    // Check in hydration range (4 blocks) plus a bit more for irregular shapes
    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) {
            // Check same level and one above (for sloped terrain)
            for (let y = 0; y <= 1; y++) {
                const block = bot.blockAt(center.offset(x, y, z));
                if (!block || !block.name || !block.position) continue;

                // Dirt and grass are ideal
                if (['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol'].includes(block.name)) {
                    const above = bot.blockAt(block.position.offset(0, 1, 0));
                    if (above && (above.name === 'air' || above.name.includes('grass') || above.name.includes('fern'))) {
                        count++;
                    }
                }
                // Sand and gravel can be replaced with dirt - count as half
                else if (['sand', 'gravel', 'clay'].includes(block.name)) {
                    const above = bot.blockAt(block.position.offset(0, 1, 0));
                    if (above && above.name === 'air') {
                        count += 0.5;
                    }
                }
            }
        }
    }
    return Math.floor(count);
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

// Check if position is within 4 blocks of a point (for farm center check)
function isWithinHydrationRangeOfPoint(pos: Vec3, waterPos: Vec3): boolean {
    const dx = Math.abs(pos.x - waterPos.x);
    const dz = Math.abs(pos.z - waterPos.z);
    const dy = Math.abs(pos.y - waterPos.y);
    return dx <= 4 && dz <= 4 && dy <= 1;
}

/**
 * Check if a position has clear sky above it (no solid blocks).
 * Used to ensure farm locations are not in caves.
 * @param bot - The bot instance
 * @param pos - Position to check
 * @param checkRadius - If > 0, also checks surrounding positions at this radius
 * @returns true if sky is clear above
 */
export function hasClearSky(bot: Bot, pos: Vec3, checkRadius: number = 0): boolean {
    const worldHeight = 320; // Max world height in modern MC
    const startY = Math.floor(pos.y) + 1;

    // Check the main position
    if (!checkColumnClear(bot, pos.x, pos.z, startY, worldHeight)) {
        return false;
    }

    // If radius specified, check surrounding positions too
    if (checkRadius > 0) {
        const offsets: [number, number][] = [
            [checkRadius, 0], [-checkRadius, 0],
            [0, checkRadius], [0, -checkRadius]
        ];
        for (const [dx, dz] of offsets) {
            if (!checkColumnClear(bot, pos.x + dx, pos.z + dz, startY, worldHeight)) {
                return false;
            }
        }
    }

    return true;
}

// Blocks that can be cleared by the bot, so they don't block farm selection
const CLEARABLE_SKY_BLOCKS = [
    // Tree parts (can be chopped)
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
    // Saplings
    'oak_sapling', 'birch_sapling', 'spruce_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'mangrove_propagule', 'cherry_sapling',
];

function checkColumnClear(bot: Bot, x: number, z: number, startY: number, maxY: number): boolean {
    // Check upward for any solid blocks
    for (let y = startY; y < Math.min(maxY, startY + 64); y++) {
        const block = bot.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)));
        if (!block) continue; // Unloaded chunk, assume clear

        // Air and transparent blocks are OK
        if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue;
        if (block.transparent) continue;

        // Trees and clearable blocks are OK (bot can remove them)
        if (block.name.includes('leaves')) continue;
        if (block.name.includes('log')) continue;
        if (CLEARABLE_SKY_BLOCKS.includes(block.name)) continue;

        // Found a solid block above - not clear sky
        return false;
    }
    return true;
}

// Check if block above has sufficient light (crops need ≥9)
// Note: Light values may not be reliable in mineflayer, so we're lenient
function hasAdequateLight(bot: Bot, farmlandPos: Vec3): boolean {
    const above = bot.blockAt(farmlandPos.offset(0, 1, 0));
    if (!above) return false;

    // If sky is visible (air above), assume adequate light during daytime
    if (above.name === 'air') {
        // Check if there's a solid block directly above that would block sunlight
        const twoAbove = bot.blockAt(farmlandPos.offset(0, 2, 0));
        if (!twoAbove || twoAbove.name === 'air') {
            return true; // Open sky, assume good light
        }
    }

    // Fall back to light level check if available
    const light = Math.max(above.skyLight ?? 15, above.light ?? 0);
    return light >= 9;
}

// ═══════════════════════════════════════════════
// EXPLORATION MEMORY HELPERS
// ═══════════════════════════════════════════════

const EXPLORATION_HISTORY_SIZE = 30;
const EXPLORATION_MEMORY_TTL = 5 * 60 * 1000; // 5 minutes
const BAD_WATER_MEMORY_TTL = 10 * 60 * 1000;  // 10 minutes for bad water

/**
 * Record a position as explored
 */
export function recordExploredPosition(bb: FarmingBlackboard, pos: Vec3, reason: string = 'visited'): void {
    // Clean up old entries first
    cleanupExplorationMemory(bb);

    bb.exploredPositions.push({
        position: pos.clone(),
        timestamp: Date.now(),
        reason
    });

    // Keep history bounded
    if (bb.exploredPositions.length > EXPLORATION_HISTORY_SIZE) {
        bb.exploredPositions.shift();
    }
}

/**
 * Record a bad water location (cave water) to avoid
 */
export function recordBadWater(bb: FarmingBlackboard, pos: Vec3): void {
    // Don't add duplicates
    const isDuplicate = bb.badWaterPositions.some(
        bw => bw.position.distanceTo(pos) < 16
    );
    if (isDuplicate) return;

    bb.badWaterPositions.push({
        position: pos.clone(),
        timestamp: Date.now(),
        reason: 'cave_water'
    });

    // Keep bounded
    if (bb.badWaterPositions.length > 20) {
        bb.badWaterPositions.shift();
    }
}

/**
 * Clean up expired exploration memory
 */
export function cleanupExplorationMemory(bb: FarmingBlackboard): void {
    const now = Date.now();

    bb.exploredPositions = bb.exploredPositions.filter(
        e => now - e.timestamp < EXPLORATION_MEMORY_TTL
    );

    bb.badWaterPositions = bb.badWaterPositions.filter(
        e => now - e.timestamp < BAD_WATER_MEMORY_TTL
    );
}

/**
 * Check if a position is near any recently explored position
 */
export function isNearExplored(bb: FarmingBlackboard, pos: Vec3, radius: number = 16): boolean {
    return bb.exploredPositions.some(
        e => e.position.distanceTo(pos) < radius
    );
}

/**
 * Check if a position is near bad water (cave water)
 */
export function isNearBadWater(bb: FarmingBlackboard, pos: Vec3, radius: number = 32): boolean {
    return bb.badWaterPositions.some(
        e => e.position.distanceTo(pos) < radius
    );
}

/**
 * Calculate exploration score for a position - higher is better (more novel)
 */
export function getExplorationScore(bb: FarmingBlackboard, pos: Vec3): number {
    let score = 100;

    // Penalize proximity to explored positions
    for (const explored of bb.exploredPositions) {
        const dist = explored.position.distanceTo(pos);
        if (dist < 32) {
            score -= (32 - dist) * 2;  // Closer = worse
        }
    }

    // Heavy penalty for proximity to bad water
    for (const badWater of bb.badWaterPositions) {
        const dist = badWater.position.distanceTo(pos);
        if (dist < 48) {
            score -= (48 - dist) * 3;  // Strong penalty
        }
    }

    return score;
}

// ═══════════════════════════════════════════════
// FACT EXTRACTION HELPERS (for GOAP planning)
// ═══════════════════════════════════════════════

/**
 * Get the urgency level for harvesting (0-100).
 * Higher means more urgent.
 */
export function getHarvestUrgency(bb: FarmingBlackboard): number {
    const cropCount = bb.nearbyMatureCrops.length;
    if (cropCount === 0) return 0;
    if (bb.inventoryFull) return 0; // Can't harvest if full

    // Base urgency on crop count
    return Math.min(100, 40 + cropCount * 3);
}

/**
 * Get the urgency level for collecting drops (0-100).
 * Very high urgency due to despawn risk.
 */
export function getDropCollectionUrgency(bb: FarmingBlackboard): number {
    const dropCount = bb.nearbyDrops.length;
    if (dropCount === 0) return 0;

    // High base urgency + scale with count
    return Math.min(100, 90 + dropCount * 2);
}

/**
 * Get the urgency level for depositing produce (0-100).
 */
export function getDepositUrgency(bb: FarmingBlackboard): number {
    if (bb.produceCount === 0) return 0;
    if (!bb.sharedChest && bb.nearbyChests.length === 0) return 0; // No storage available

    if (bb.inventoryFull) return 90;
    if (bb.produceCount > 32) return 70;
    if (bb.produceCount > 16) return 40;
    return 20;
}

/**
 * Get the urgency level for planting seeds (0-100).
 */
export function getPlantUrgency(bb: FarmingBlackboard): number {
    if (!bb.canPlant) return 0;
    const emptyFarmland = bb.nearbyFarmland.length;
    if (emptyFarmland === 0) return 0;

    // More empty farmland = more urgent to plant
    return Math.min(60, 30 + emptyFarmland * 2);
}

/**
 * Get the urgency level for obtaining tools (0-100).
 */
export function getToolUrgency(bb: FarmingBlackboard): number {
    if (!bb.needsTools) return 0;

    // Very high priority - can't farm without tools
    return 80;
}

/**
 * Get the urgency level for gathering seeds (0-100).
 */
export function getSeedGatheringUrgency(bb: FarmingBlackboard): number {
    if (!bb.needsSeeds) return 0;
    if (bb.nearbyGrass.length === 0) return 0;

    // Moderate priority
    return 50;
}

/**
 * Check if the bot has materials to craft something.
 */
export function hasMaterialsForCrafting(bb: FarmingBlackboard, recipe: string): boolean {
    switch (recipe) {
        case 'wooden_hoe':
            // Need 2 planks and 2 sticks (or enough to make sticks)
            return bb.plankCount >= 2 && (bb.stickCount >= 2 || bb.plankCount >= 4);
        case 'crafting_table':
            return bb.plankCount >= 4;
        case 'sticks':
            return bb.plankCount >= 2;
        default:
            return false;
    }
}