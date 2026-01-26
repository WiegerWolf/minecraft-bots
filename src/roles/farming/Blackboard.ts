import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { VillageChat, TradeOffer, ActiveTrade } from '../../shared/VillageChat';
import type { Logger } from '../../shared/logger';
import { SIGN_SEARCH_RADIUS } from '../../shared/SignKnowledge';
import { type StuckTracker, createStuckTracker } from '../../shared/PathfindingUtils';
import { type InventoryItem, getTradeableItems, isWantedByRole, getItemCount } from '../../shared/ItemCategories';

export interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;  // Why this location was recorded (e.g., 'visited', 'bad_water')
}

/**
 * Pending sign write entry - queued when farm/water is established
 */
export interface PendingSignWrite {
    type: 'FARM' | 'WATER';
    pos: Vec3;
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
    villageCenter: Vec3 | null;  // Village center established by lumberjack
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

    // Logging (set by role)
    log: Logger | null;

    // Pathfinding stuck detection (for hole escape)
    stuckTracker: StuckTracker;

    // Computed booleans for easy decision making
    canTill: boolean;
    canPlant: boolean;
    canHarvest: boolean;
    needsTools: boolean;
    needsSeeds: boolean;
    inventoryFull: boolean;

    // Terraform state
    waitingForTerraform: boolean;
    terraformRequestedAt: Vec3 | null;

    // Sign-based persistent knowledge system
    spawnPosition: Vec3 | null;           // Where bot spawned (sign location)
    hasStudiedSigns: boolean;             // Has bot walked to and read signs near spawn

    // Curious bot - sign tracking
    readSignPositions: Set<string>;       // Sign positions we've read (stringified: "x,y,z")
    unknownSigns: Vec3[];                 // Signs spotted but not yet read

    // Knowledge from signs
    knownFarms: Vec3[];                   // Farm locations from signs
    knownWaterSources: Vec3[];            // Water source locations from signs

    // Sign writing (persistent knowledge for other bots/restarts)
    pendingSignWrites: PendingSignWrite[];      // Queue of signs to write
    signPositions: Map<string, Vec3>;           // type -> sign position (for updates)
    farmSignWritten: boolean;                   // Has farm center sign been written?

    // ═══════════════════════════════════════════════════════════════
    // CHEST BACKOFF (prevent spam checking empty chest)
    // ═══════════════════════════════════════════════════════════════
    chestEmptyUntil: number;                    // Timestamp when chest backoff expires

    // ═══════════════════════════════════════════════════════════════
    // EXPLORATION COOLDOWN (prevent rapid explore cycling)
    // ═══════════════════════════════════════════════════════════════
    exploreOnCooldownUntil: number;             // Timestamp when explore cooldown expires

    // ═══════════════════════════════════════════════════════════════
    // TRADE STATE
    // ═══════════════════════════════════════════════════════════════
    tradeableItems: InventoryItem[];            // Items we can offer for trade
    tradeableItemCount: number;                 // Total count of tradeable items
    pendingTradeOffers: TradeOffer[];           // Active offers from other bots we might want
    activeTrade: ActiveTrade | null;            // Current trade state (if any)
    lastOfferTime: number;                      // When we last broadcast an offer (cooldown)
    consecutiveNoTakers: number;                // Consecutive "no takers" for trade backoff

    // ═══════════════════════════════════════════════════════════════
    // LUMBERJACK TRACKING (for following during exploration)
    // ═══════════════════════════════════════════════════════════════
    lumberjackPosition: Vec3 | null;            // Last known position of a lumberjack
    lumberjackName: string | null;              // Name of the lumberjack being followed

    // ═══════════════════════════════════════════════════════════════
    // ACTION PREEMPTION (allows high-priority goals to interrupt)
    // ═══════════════════════════════════════════════════════════════
    preemptionRequested: boolean;               // Set by GOAP when higher-priority goal detected
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
        villageCenter: null,
        lastAction: 'none',
        consecutiveIdleTicks: 0,

        exploredPositions: [],
        badWaterPositions: [],
        unreachableDrops: new Map(),

        currentTreeHarvest: null,

        villageChat: null,
        log: null,

        stuckTracker: createStuckTracker(),

        canTill: false,
        canPlant: false,
        canHarvest: false,
        needsTools: false,
        needsSeeds: false,
        inventoryFull: false,

        waitingForTerraform: false,
        terraformRequestedAt: null,

        // Sign-based persistent knowledge
        spawnPosition: null,
        hasStudiedSigns: false,

        // Curious bot - sign tracking
        readSignPositions: new Set(),
        unknownSigns: [],

        // Knowledge from signs
        knownFarms: [],
        knownWaterSources: [],

        // Sign writing
        pendingSignWrites: [],
        signPositions: new Map(),
        farmSignWritten: false,

        // Chest backoff
        chestEmptyUntil: 0,

        // Exploration cooldown
        exploreOnCooldownUntil: 0,

        // Trade state
        tradeableItems: [],
        tradeableItemCount: 0,
        pendingTradeOffers: [],
        activeTrade: null,
        lastOfferTime: 0,
        consecutiveNoTakers: 0,

        // Lumberjack tracking
        lumberjackPosition: null,
        lumberjackName: null,

        // Action preemption
        preemptionRequested: false,
    };
}

// Helper to yield to event loop, allowing keepalives to be processed
const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

export async function updateBlackboard(bot: Bot, bb: FarmingBlackboard): Promise<void> {
    const pos = bot.entity.position;
    const inv = bot.inventory.items();

    // Check if we're actively trading - if so, skip expensive world perception
    const isTrading = bb.villageChat?.getActiveTrade()?.status !== undefined &&
                      bb.villageChat?.getActiveTrade()?.status !== 'idle';

    // Yield early to let keepalives through
    await yieldToEventLoop();

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
    // TRADE STATE (must update even during trading)
    // ═══════════════════════════════════════════════
    if (bb.villageChat) {
        bb.pendingTradeOffers = bb.villageChat.getActiveOffers()
            .filter(o => isWantedByRole(o.item, 'farmer'));
        bb.activeTrade = bb.villageChat.getActiveTrade();
        bb.villageChat.periodicCleanup();
    }

    // ═══════════════════════════════════════════════
    // WORLD PERCEPTION (expensive, cache results)
    // ═══════════════════════════════════════════════
    const searchCenter = bb.farmCenter || pos;
    // Skip expensive world perception during active trading to keep event loop responsive
    if (isTrading) {
        // Keep existing perception, just yield and return
        await yieldToEventLoop();
        return;
    }

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

    // Yield to event loop after expensive findBlocks operation
    await yieldToEventLoop();

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
        // Filter by Y-level: farmland MUST be at same Y as water to be hydrated
        // In Minecraft, water only hydrates farmland at the SAME Y level, not above/below!
        if (bb.farmCenter) {
            const yDiff = b.position.y - farmCenterY;
            if (yDiff !== 0) return false;  // Only accept Y=0 (same level as water)
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
            bb.log?.debug({ total: rawFarmland.length, atCorrectY: correctYBlocks.length, empty: withAir, planted: withCrops }, 'Farmland analysis');
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
            return { name: b.name, age: props.age ?? '?' };
        });
        bb.log?.debug({ total: allCrops.length, mature: bb.nearbyMatureCrops.length, sample }, 'Crop status');
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

    // Building materials - farmer should NOT pick these up (landscaper needs them)
    const LANDSCAPER_MATERIALS = ['dirt', 'cobblestone', 'stone', 'gravel', 'sand', 'andesite', 'diorite', 'granite'];

    // Find dropped items - filter to only include reachable farming-related items
    bb.nearbyDrops = Object.values(bot.entities).filter(e => {
        if (e.name !== 'item' || !e.position) return false;
        if (e.position.distanceTo(pos) >= 16) return false;

        // Skip items marked as unreachable
        if (bb.unreachableDrops.has(e.id)) return false;

        // Skip items in other bots' trade zones (don't steal traded items)
        if (bb.villageChat?.isInOtherTradeZone(e.position)) return false;

        // Skip landscaper materials - let the landscaper pick these up
        const metadata = (e as any).metadata;
        if (metadata && Array.isArray(metadata)) {
            const itemStack = metadata.find((m: any) => m && typeof m === 'object' && 'itemId' in m);
            if (itemStack) {
                const itemName = bot.registry?.items?.[itemStack.itemId]?.name;
                if (itemName && LANDSCAPER_MATERIALS.includes(itemName)) {
                    return false;
                }
            }
        }

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

    // Get shared village state from chat
    if (bb.villageChat) {
        bb.villageCenter = bb.villageChat.getVillageCenter();
        bb.sharedChest = bb.villageChat.getSharedChest();
        bb.sharedCraftingTable = bb.villageChat.getSharedCraftingTable();

        // Check terraform status
        if (bb.terraformRequestedAt) {
            if (bb.villageChat.isTerraformDoneAt(bb.terraformRequestedAt)) {
                bb.log?.info({ pos: bb.terraformRequestedAt.floored().toString() }, 'Terraform complete');
                bb.waitingForTerraform = false;
                bb.terraformRequestedAt = null;
            }
        }
    }

    // ═══════════════════════════════════════════════
    // COMPUTED DECISIONS
    // ═══════════════════════════════════════════════
    bb.needsTools = !bb.hasHoe;
    bb.needsSeeds = bb.seedCount < 10;  // Match GOAP goal threshold
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
            bb.log?.info({ pos: bb.farmCenter.toString(), tillable }, 'Established farm center');
        } else if (bb.nearbyWater.length > 0) {
            bb.log?.debug({ waterSources: bb.nearbyWater.length }, 'Found water but none under clear sky');
        }
    }

    // Validate existing farm center (should be water - the irrigation source)
    if (bb.farmCenter) {
        const block = bot.blockAt(bb.farmCenter);
        if (!block || (block.name !== 'water' && block.name !== 'flowing_water')) {
            bb.log?.warn({ blockName: block?.name ?? 'null' }, 'Farm center invalid, clearing');
            bb.farmCenter = null;
        }
    }

    // Queue FARM sign write if farm center exists but sign not written yet
    // This is separate from farm establishment to handle all code paths that set farmCenter
    // (FindFarmCenter action, StudySpawnSigns, ReadUnknownSign, etc.)
    if (bb.farmCenter && bb.spawnPosition && !bb.farmSignWritten) {
        bb.pendingSignWrites.push({
            type: 'FARM',
            pos: bb.farmCenter.clone()
        });
        bb.farmSignWritten = true;
        bb.log?.info({ pos: bb.farmCenter.toString() }, 'Queued FARM sign write');
    }

    // ═══════════════════════════════════════════════
    // TRADEABLE ITEMS
    // ═══════════════════════════════════════════════
    // Convert inventory to InventoryItem format
    const invItems: InventoryItem[] = inv.map(i => ({ name: i.name, count: i.count }));

    // Get items we can trade (unwanted + helpful items)
    bb.tradeableItems = getTradeableItems(invItems, 'farmer');
    bb.tradeableItemCount = bb.tradeableItems.reduce((sum, item) => sum + item.count, 0);

    // Note: Trade state from villageChat is updated at the start of this function
    // (before the isTrading early-return) to ensure goals have fresh state

    // ═══════════════════════════════════════════════
    // LUMBERJACK TRACKING
    // ═══════════════════════════════════════════════
    // Track lumberjack position for following during exploration phase
    // Only track if we don't have a village center yet (exploration phase)
    if (!bb.villageCenter) {
        bb.lumberjackPosition = null;
        bb.lumberjackName = null;

        // Find the closest lumberjack player
        let lumberjackFound = false;
        let lumberjackOutOfRange = false;
        let lumberjackOutOfRangeName: string | null = null;

        for (const [playerName, player] of Object.entries(bot.players)) {
            // Skip self
            if (playerName === bot.username) continue;

            // Check if this is a lumberjack (name contains Lmbr, Lumberjack, etc.)
            const isLumberjack = playerName.includes('Lmbr') ||
                                 playerName.toLowerCase().includes('lumber') ||
                                 playerName.toLowerCase().includes('lumberjack');
            if (!isLumberjack) continue;

            lumberjackFound = true;

            // Get their entity (only works if they're in render distance)
            const entity = player.entity;
            if (!entity) {
                // Player is in players list but entity not loaded (out of render distance)
                lumberjackOutOfRange = true;
                lumberjackOutOfRangeName = playerName;
                continue;
            }

            const distance = pos.distanceTo(entity.position);

            // Update if this is the first or closest lumberjack
            if (!bb.lumberjackPosition || distance < pos.distanceTo(bb.lumberjackPosition)) {
                bb.lumberjackPosition = entity.position.clone();
                bb.lumberjackName = playerName;
            }
        }

        if (bb.lumberjackPosition) {
            bb.log?.debug({
                lumberjack: bb.lumberjackName,
                distance: pos.distanceTo(bb.lumberjackPosition).toFixed(1)
            }, 'Tracking lumberjack');
        } else if (lumberjackOutOfRange) {
            // Log when lumberjack exists but is out of render distance
            bb.log?.debug({
                lumberjack: lumberjackOutOfRangeName
            }, 'Lumberjack out of render distance - cannot follow');
        }
    } else {
        // Village established, no need to follow
        bb.lumberjackPosition = null;
        bb.lumberjackName = null;
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
    // IMPORTANT: Only count at Y=0 (same level as water) - that's where hydration works!
    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) {
            // Skip the water block itself
            if (x === 0 && z === 0) continue;

            const block = bot.blockAt(center.offset(x, 0, z));  // Y=0 only
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

// ═══════════════════════════════════════════════
// TERRAIN QUALITY HELPERS (for terraform)
// ═══════════════════════════════════════════════

/**
 * Check terrain quality around a position.
 * Returns true if the terrain needs terraforming to be farmable.
 *
 * @param bot - The bot instance
 * @param center - Center position (usually water source)
 * @returns true if terrain is rough and needs terraforming
 */
export function needsTerraforming(bot: Bot, center: Vec3): boolean {
    const radius = 4; // Check hydration range
    const targetY = center.y;

    let badBlocks = 0;
    let totalChecked = 0;

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            const x = Math.floor(center.x) + dx;
            const z = Math.floor(center.z) + dz;

            // Check surface level
            const surfacePos = new Vec3(x, targetY, z);
            const surfaceBlock = bot.blockAt(surfacePos);
            if (!surfaceBlock) continue;

            // Skip water
            if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water') continue;

            totalChecked++;

            // Check for obstacles above target level
            const aboveBlock = bot.blockAt(surfacePos.offset(0, 1, 0));
            if (aboveBlock && aboveBlock.name !== 'air' &&
                !aboveBlock.name.includes('grass') && !aboveBlock.name.includes('fern')) {
                badBlocks++;
            }

            // Check for non-farmable surface
            if (!['grass_block', 'dirt', 'farmland', 'air'].includes(surfaceBlock.name)) {
                badBlocks++;
            }
        }
    }

    // If more than 30% of the area needs work, request terraform
    if (totalChecked === 0) return false;
    const badRatio = badBlocks / totalChecked;
    return badRatio > 0.3;
}

/**
 * Request terraforming at the farm center.
 * Only requests if not already requested and terrain needs work.
 *
 * @returns true if terraform was requested
 */
export function requestTerraformIfNeeded(bot: Bot, bb: FarmingBlackboard): boolean {
    if (!bb.farmCenter || !bb.villageChat) return false;
    if (bb.waitingForTerraform) return false;
    if (bb.terraformRequestedAt) return false;

    // Check if already has terraform request
    if (bb.villageChat.hasTerraformRequestAt(bb.farmCenter)) {
        bb.waitingForTerraform = true;
        bb.terraformRequestedAt = bb.farmCenter.clone();
        return false;
    }

    // Check if terrain actually needs terraforming
    if (!needsTerraforming(bot, bb.farmCenter)) {
        return false;
    }

    // Request terraform
    bb.log?.info({ pos: bb.farmCenter.floored().toString() }, 'Requesting terraform');
    bb.villageChat.requestTerraform(bb.farmCenter);
    bb.waitingForTerraform = true;
    bb.terraformRequestedAt = bb.farmCenter.clone();
    return true;
}