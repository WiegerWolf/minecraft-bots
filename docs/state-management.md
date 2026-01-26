# State Management

This document explains how the bot tracks and reasons about the world, and why state is split across multiple systems.

## The Three State Systems

```
┌─────────────────────────────────────────────────────┐
│                   Minecraft World                    │
│         (blocks, entities, player state)            │
└────────────────────────┬────────────────────────────┘
                         │
                    perception
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                    Blackboard                        │
│     (rich, mutable perception + memory)             │
│                                                      │
│  nearbyWater: Block[]     // Actual block refs      │
│  exploredPositions: []    // Spatial memory         │
│  unreachableDrops: Map    // Temporal memory        │
└────────────────────────┬────────────────────────────┘
                         │
                    extraction
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                    WorldState                        │
│       (immutable facts for planning)                │
│                                                      │
│  'nearby.water': 5        // Just counts            │
│  'has.hoe': true          // Just booleans          │
│  'inv.seeds': 23          // Just numbers           │
└─────────────────────────────────────────────────────┘
```

## Why Blackboard?

The Blackboard pattern comes from AI architecture - a shared memory where different subsystems write and read.

### What It Stores

```typescript
interface FarmingBlackboard {
    // Real-time perception (refreshed every tick)
    nearbyWater: Block[];
    nearbyFarmland: Block[];
    nearbyMatureCrops: Block[];
    nearbyDrops: Entity[];

    // Derived inventory state
    hasHoe: boolean;
    seedCount: number;
    produceCount: number;

    // Long-term memory
    farmCenter: Vec3 | null;
    exploredPositions: ExplorationMemory[];
    badWaterPositions: ExplorationMemory[];
    unreachableDrops: Map<number, number>;

    // Computed decisions
    canTill: boolean;
    canHarvest: boolean;
}
```

### Why Actions Need Blackboard

Actions do real work. They need rich data:

```typescript
// In HarvestCrops action
async tick(bot: Bot, bb: FarmingBlackboard) {
    // Need actual Block reference to harvest
    const crop = bb.nearbyMatureCrops[0];
    if (!crop) return 'failure';

    // Navigate to the block
    await bot.pathfinder.goto(new GoalNear(crop.position, 2));

    // Break it
    await bot.dig(crop);
    return 'success';
}
```

You can't harvest a number. You need the Block object.

### Why Mutable?

Actions mutate the blackboard during execution:

```typescript
// After trying and failing to reach a drop
bb.unreachableDrops.set(entity.id, Date.now() + 30000);
```

This temporal memory prevents the bot from trying the same unreachable item repeatedly.

## Why WorldState?

WorldState is a completely separate abstraction optimized for planning.

### What It Stores

```typescript
// Just facts - no complex objects
ws.set('nearby.water', 5);
ws.set('has.hoe', true);
ws.set('inv.seeds', 23);
ws.set('derived.canCraftHoe', true);
```

### Why Planning Can't Use Blackboard

The A* planner explores hypothetical futures:

```
What if I do HarvestCrops? → simulate → new state
What if I do PlantSeeds? → simulate → different state
```

This requires cloning state hundreds of times. Blackboard contains:
- Block references (can't clone meaningfully)
- Entity references (change over time)
- Maps with timestamps (stale after cloning)

### Why Immutable During Planning

```typescript
// In planner
const newState = current.state.clone();  // Deep copy
this.applyEffects(action, newState);     // Modify copy
```

If planning mutated the real state, we'd corrupt reality while exploring possibilities.

### Why Simple Types

```typescript
type FactValue = number | boolean | string | Vec3 | null;
```

These are:
- **Clonable**: `new WorldState(new Map(facts))`
- **Comparable**: `oldValue !== newValue`
- **Serializable**: Could save/restore if needed

Block and Entity objects don't have these properties.

## The Translation Layer: WorldStateBuilder

```typescript
static fromBlackboard(bot: Bot, bb: FarmingBlackboard): WorldState {
    const ws = new WorldState();

    // Convert rich data to facts
    ws.set('inv.seeds', bb.seedCount);
    ws.set('has.hoe', bb.hasHoe);
    ws.set('nearby.matureCrops', bb.nearbyMatureCrops.length);
    ws.set('derived.hasFarmEstablished', bb.farmCenter !== null);

    return ws;
}
```

### Why Derived Facts?

Some planning-relevant facts don't exist directly in the blackboard:

```typescript
// Can we craft a hoe?
ws.set('derived.canCraftHoe',
    bb.plankCount >= 2 && (bb.stickCount >= 2 || bb.plankCount >= 4)
);
```

This computation happens once in the builder, then planning uses it many times.

### Derived Facts Must Reflect Reality

**Bug pattern to avoid**: Derived facts like `hasStorageAccess` must account for runtime state, not just existence.

Example: `hasStorageAccess` was computed as `sharedChest !== null || nearbyChests.length > 0`. But if all chests are full (tracked in `bb.fullChests`), storage isn't actually available. The `DepositLogs` goal would be selected but always fail.

**Rule**: Derived facts should answer "can I actually do this?" not just "does the infrastructure exist?"

### Why Not Just Read Blackboard During Planning?

1. **Performance**: Computing `canCraftHoe` once vs. recomputing during each A* expansion
2. **Consistency**: Facts frozen at start of planning cycle, no mid-planning changes
3. **Separation**: Planner doesn't know about blackboard structure

## Blackboard Updates

### The Update Cycle

```typescript
export function updateBlackboard(bot: Bot, bb: FarmingBlackboard): void {
    const pos = bot.entity.position;

    // Inventory analysis (cheap)
    bb.hasHoe = bot.inventory.items().some(i => i.name.includes('hoe'));
    bb.seedCount = countSeeds(bot);

    // World perception (expensive)
    bb.nearbyWater = bot.findBlocks({ matching: isWater, maxDistance: 64 });
    bb.nearbyMatureCrops = findMatureCrops(bot);

    // Computed decisions
    bb.canHarvest = bb.nearbyMatureCrops.length > 0 && !bb.inventoryFull;
    bb.canTill = bb.hasHoe && bb.seedCount > 0 && bb.nearbyWater.length > 0;
}
```

### Why Order Matters

1. **Inventory first**: Cheap, needed for computed decisions
2. **Perception second**: Expensive, but we have inventory context
3. **Computed last**: Depends on everything above

### Why Not Cache Perception?

Perception is refreshed every tick because:
- Crops grow
- Items despawn
- Other entities move
- Blocks change

Caching would cause the bot to act on stale information.

### Critical: Search Radii Must Match Actions

**Bug pattern to avoid**: If the blackboard searches for resources (trees, crops, etc.) at a larger radius than the action uses, the planner will think resources exist but actions will fail to find them.

Example: Blackboard searched 64 blocks for trees, but `ChopTree` action only searched 32 blocks. Result: `nearby.trees > 0` so planner selects `ChopTree`, but action returns failure because `findTree(32)` finds nothing.

**Rule**: Blackboard search radii must match or be smaller than corresponding action radii.

## Memory Systems

### Exploration Memory

```typescript
interface ExplorationMemory {
    position: Vec3;
    timestamp: number;
    reason?: string;  // 'visited', 'unreachable', 'no_valid_directions', 'error'
}

bb.exploredPositions = [
    { position: Vec3(100, 64, 200), timestamp: 1705123456789, reason: 'visited' },
    ...
];
```

**Why track exploration?**

Without it, exploration actions might:
1. Walk 32 blocks north
2. Walk 32 blocks south (back to start)
3. Walk 32 blocks north again
4. ...

Memory ensures "go somewhere new."

**Helper functions for exploration:**

```typescript
// Record a position as explored
recordExploredPosition(bb, pos, 'visited');

// Check if a position is near explored areas (within 16 blocks)
isNearExplored(bb, pos, radius);

// Get a score for a position (100 base, minus penalties for nearby explored)
// Used to prioritize unexplored directions
getExplorationScore(bb, pos);
```

**How `getExplorationScore()` works:**

```typescript
function getExplorationScore(bb, pos): number {
    let score = 100;
    for (const explored of bb.exploredPositions) {
        const dist = explored.position.distanceTo(pos);
        if (dist < 32) {
            score -= (32 - dist) * 2;  // Closer = bigger penalty
        }
    }
    return score;
}
```

This gives high scores to unexplored areas and low scores to areas near recent exploration.

**Used by:** `FindForest` (scores all 8 directions, picks highest), `PatrolForest` (scores candidates)

**Why timestamps?**

Old memories expire:
```typescript
bb.exploredPositions = bb.exploredPositions.filter(
    e => Date.now() - e.timestamp < 5 * 60 * 1000  // 5 minutes
);
```

After 5 minutes, an area is "new" again. The world may have changed.

### Bad Water Memory

```typescript
bb.badWaterPositions = [
    { position: Vec3(50, 12, 100), timestamp: ..., reason: 'cave_water' }
];
```

**Why track "bad" water?**

The bot discovered water at Y=12. This is cave water - useless for farming. Without memory:
1. Find water at (50, 12, 100)
2. Go there, realize it's underground
3. Explore, find different water at (50, 12, 100) again
4. ...

Bad water memory prevents revisiting known caves.

### Unreachable Drops

```typescript
bb.unreachableDrops = new Map([
    [entityId, expiryTimestamp],
    ...
]);
```

**Why by entity ID?**

Item entities have stable IDs during their lifetime. Tracking by ID means:
- We know WHICH specific item was unreachable
- If the item moves (falls, pushed), we'd still skip it
- When the item despawns, the ID becomes invalid naturally

**Why expiry timestamps?**

```typescript
// Mark as unreachable for 30 seconds
bb.unreachableDrops.set(entity.id, Date.now() + 30000);
```

Conditions change. After 30 seconds:
- Obstacle might have moved
- Bot might approach from different angle
- Item might have moved to accessible location

### Sign-Based Persistence (Lumberjack & Farmer)

Signs near spawn serve as persistent memory that survives bot restarts and deaths. Both lumberjack and farmer bots can read and learn from signs.

```typescript
// Lumberjack-specific persistence fields
bb.spawnPosition: Vec3 | null;           // Where bot spawned
bb.pendingSignWrites: PendingSignWrite[]; // Queue of signs to write
bb.hasStudiedSigns: boolean;             // Has bot walked to and read signs?
bb.hasCheckedStorage: boolean;           // Has bot checked chest for supplies?

// Multi-instance infrastructure
bb.knownChests: Vec3[];                  // All chest positions from signs
bb.knownForests: Vec3[];                 // Forest/tree area positions
bb.fullChests: Map<string, number>;      // pos -> expiry timestamp

// Sign tracking
bb.readSignPositions: Set<string>;       // "x,y,z" keys of read signs
bb.unknownSigns: Vec3[];                 // Signs spotted but not yet read
```

```typescript
// Farmer-specific persistence fields
bb.spawnPosition: Vec3 | null;           // Where bot spawned
bb.hasStudiedSigns: boolean;             // Has bot walked to and read signs?

// Knowledge from signs
bb.knownFarms: Vec3[];                   // Farm locations from signs
bb.knownWaterSources: Vec3[];            // Water source locations from signs

// Sign tracking
bb.readSignPositions: Set<string>;       // "x,y,z" keys of read signs
bb.unknownSigns: Vec3[];                 // Signs spotted but not yet read

// Sign writing (farmer writes FARM signs when establishing farm center)
bb.pendingSignWrites: PendingSignWrite[]; // Queue of signs to write
bb.signPositions: Map<string, Vec3>;      // type -> sign position (for updates)
bb.farmSignWritten: boolean;              // Has farm center sign been written?
```

**Sign types:**
- Infrastructure (single instance): `VILLAGE`, `CRAFT`
- Infrastructure (multiple): `CHEST` (all use same type, collected into array)
- Landmarks: `FOREST`, `MINE`, `FARM`, `WATER`

**Why `knownChests[]` array instead of single chest?**

As the bot fills chests, it needs alternatives:
1. First chest fills up → marked in `fullChests` for 5 minutes
2. Bot checks `knownChests` for next closest non-full chest
3. If all full → craft and place new chest → add to array → write new sign

This prevents the bot from getting stuck with a full inventory.

**Why `hasStudiedSigns` flag?**

On spawn, the bot walks to each sign, looks at it, and announces what it learned. This:
- Creates roleplay immersion ("I'm learning from the village signs")
- Only happens once per session
- Populates `knownChests`, `knownForests`, etc.

**Why track `readSignPositions`?**

Prevents re-reading signs the bot already knows about. Used for:
- Skipping known signs during curious exploration
- Identifying truly "unknown" signs in the world

**Why `unknownSigns[]` for curious behavior?**

When the bot perceives a sign it hasn't read, it adds to `unknownSigns`. The `ReadUnknownSign` goal provides low-priority curiosity behavior:
- Bot walks to the sign, looks at it
- If knowledge sign → learns from it
- If decoration → quotes what it saw
- Creates emergent exploration behavior

**Why a queue for sign writes?**

Infrastructure creation (chest, crafting table) triggers sign writes:
```typescript
bb.pendingSignWrites.push({ type: 'CHEST', pos: chestPos });
```

The queue pattern allows:
- Immediate return from infrastructure action
- GOAP planner schedules sign writing separately
- Multiple signs can queue up, written one at a time

### Trade State (All Roles)

All roles track direct trading state for hand-to-hand item exchange:

```typescript
// Trade state fields (shared across all blackboards)
bb.tradeableItems: InventoryItem[];     // Items this role doesn't need
bb.tradeableItemCount: number;          // Count of tradeable items
bb.pendingTradeOffers: TradeOffer[];    // Active offers from other bots
bb.activeTrade: ActiveTrade | null;     // Current trade in progress
bb.lastOfferTime: number;               // Timestamp of last broadcast (cooldown)
bb.consecutiveNoTakers: number;         // Consecutive "no takers" for trade backoff
```

**Why track `tradeableItems` in blackboard?**

Computing "unwanted" items requires:
- Checking item name against role's wanted list
- Pattern matching (e.g., `*_seeds` matches `wheat_seeds`)
- This is done once per tick, not repeatedly

**Why `pendingTradeOffers` array?**

Multiple bots might offer items simultaneously:
```
[OFFER] oak_sapling 4    // From lumberjack
[OFFER] wheat_seeds 8    // From farmer
```

Bot evaluates which offer is most valuable and responds to one.

**Why `activeTrade` state machine?**

Trade involves multiple steps:
```typescript
interface ActiveTrade {
    partner: string;           // Who we're trading with
    item: string;              // What item
    quantity: number;          // How many
    meetingPoint: Vec3 | null; // Where to meet
    role: 'giver' | 'receiver';// Our role in trade
    status: TradeStatus;       // Current phase
    partnerReady: boolean;     // Is partner at meeting point?
    wantResponses: WantResponse[]; // Collected during 5s window (giver only)
    offerTimestamp: number;    // When offer was made
}

type TradeStatus =
    | 'offering'    // Giver: broadcast offer, collecting responses
    | 'wanting'     // Receiver: sent [WANT], waiting for accept
    | 'accepted'    // Trade accepted, traveling
    | 'traveling'   // Pathfinding to meeting point
    | 'ready'       // At meeting point, waiting for partner
    | 'dropping'    // Giver: dropping items
    | 'picking_up'  // Receiver: collecting dropped items
    | 'done'        // Trade complete
    | 'cancelled';  // Trade failed
```

**Why 30-second cooldown (`lastOfferTime`)?**

Without cooldown:
1. Bot offers items
2. No one responds (all busy)
3. Bot immediately offers again
4. Chat spam, wasted processing

30 seconds is long enough to:
- Allow work between offers
- Not flood chat
- Still clear inventory reasonably fast

### Lumberjack Tracking (Farmer/Landscaper)

During the exploration phase (before village center is established), farmers and landscapers can follow lumberjacks to stay together:

```typescript
// Lumberjack tracking fields
bb.lumberjackPosition: Vec3 | null;     // Last known position of a lumberjack
bb.lumberjackName: string | null;       // Name of the lumberjack being followed
```

**Why track lumberjacks?**

In early game, bots spawn together but can easily separate. The lumberjack typically establishes the village center first. Without tracking:
1. Farmer explores in random direction
2. Lumberjack explores different direction
3. They end up 200+ blocks apart
4. Trading and coordination become impossible

With tracking, farmers and landscapers follow lumberjacks during exploration, staying within ~64 blocks until village is established.

**Why only during exploration phase?**

Once village center is established (`bb.villageCenter !== null`), all bots have a common reference point. Tracking becomes unnecessary and could interfere with farming/terraforming work.

### Need Delivery Tracking (Farmer)

When a farmer broadcasts a need (like "I need a hoe") and a provider accepts, the farmer tracks the pending delivery:

```typescript
bb.pendingDelivery: {
    needId: string;                           // ID of the active need
    location: Vec3;                           // Where to pick up items
    method: 'chest' | 'trade';                // How items will be delivered
    items: Array<{ name: string; count: number }>;  // What to expect
} | null;
```

**Why track pending deliveries?**

After a need is accepted, the farmer must:
1. Know where to go to receive items
2. Know what to expect
3. Mark the need as fulfilled after pickup

Without explicit tracking, the farmer might:
- Keep broadcasting the same need
- Not know where the provider left items
- Miss the delivery entirely

### Action Preemption

Actions can be interrupted by higher-priority goals:

```typescript
bb.preemptionRequested: boolean;    // Set by GOAP when higher-priority goal detected
```

When `preemptionRequested` is true, the current action should exit cleanly at the next opportunity. This allows urgent goals (like `RespondToTradeOffer`) to interrupt long-running actions (like `CheckSharedChest` waiting for materials).

### Exploration Cooldown and Chest Backoff

```typescript
bb.chestEmptyUntil: number;           // Timestamp when chest backoff expires
bb.exploreOnCooldownUntil: number;    // Timestamp when explore cooldown expires
```

**Why chest backoff?**

If a farmer checks a shared chest and finds it empty, repeatedly checking wastes time. A 30-second backoff prevents spam checking.

**Why explore cooldown?**

Exploration is expensive (pathfinding, world loading). If exploration fails to find resources, a cooldown prevents rapid retry cycles that accomplish nothing.

## Farm Center: Critical Strategic State

```typescript
bb.farmCenter: Vec3 | null;
```

### What It Represents

The farm center is **the water block** around which the farm is built. In Minecraft, water hydrates farmland within 4 blocks.

### Why Track It?

Without a remembered farm center:
1. Find water, start farming
2. Explore for seeds
3. Return... where?
4. Find different water, start second farm
5. Two half-built farms, neither productive

### How It's Established

```typescript
if (!bb.farmCenter && bb.nearbyWater.length > 0) {
    const candidates = bb.nearbyWater
        .filter(w => hasClearSky(bot, w.position))  // Not in caves
        .sort((a, b) => countTillableAround(b) - countTillableAround(a));

    bb.farmCenter = candidates[0]?.position.clone();
}
```

**Why filter for clear sky?**

Cave water can't grow crops (no light). Farming there is futile.

**Why sort by tillable count?**

Water near dirt/grass can become a farm. Water surrounded by stone cannot.

### Why It Persists

Farm center is never cleared during normal operation. It represents a commitment: "This is where I'm building my farm."

Clearing it would make the bot abandon work-in-progress.

## Computed Decisions

```typescript
// In updateBlackboard
bb.canHarvest = bb.nearbyMatureCrops.length > 0 && !bb.inventoryFull;
bb.canPlant = bb.hasHoe && bb.seedCount > 0 && bb.nearbyFarmland.length > 0;
bb.canTill = bb.hasHoe && bb.seedCount > 0 && bb.nearbyWater.length > 0;
bb.needsTools = !bb.hasHoe;
bb.needsSeeds = bb.seedCount < 10;
```

### Why Compute in Blackboard?

These are used:
1. By WorldStateBuilder for planning facts
2. By actions for quick checks
3. By goals for utility calculation

Computing once, using many times.

### Why Threshold of 10 Seeds?

```typescript
bb.needsSeeds = bb.seedCount < 10;
```

- **0 seeds**: Critical, can't plant at all
- **5 seeds**: Low, should gather more
- **10+ seeds**: Comfortable buffer

The threshold balances:
- Not wasting time gathering when you have enough
- Not running out mid-planting cycle

## WorldState Diffing

```typescript
// In WorldState class
diff(other: WorldState): number {
    let differences = 0;
    const allKeys = new Set([...this.keys(), ...other.keys()]);

    for (const key of allKeys) {
        if (this.get(key) !== other.get(key)) {
            differences++;
        }
    }
    return differences;
}
```

### Why Diff States?

The executor monitors for world changes:
```typescript
checkWorldStateChange(currentState: WorldState): void {
    const changes = currentState.diff(this.initialWorldState);
    if (changes >= 5) {
        this.requestReplan(REASON.WORLD_CHANGED);
    }
}
```

### Why Threshold of 5?

Small changes are normal:
- `inv.produce` changes as we harvest
- `nearby.drops` fluctuates

But 5+ changes suggest major world shift:
- Moved to new area
- Someone else modified farm
- Significant time passed

### Why Not Hash Comparison?

Hashing would only tell us "same" or "different". The count helps with threshold tuning and debugging.

## WorldState Fact Reference

The WorldStateBuilder extracts facts from blackboards into the following categories:

### Common Facts (All Roles)

```typescript
// Inventory
ws.set('inv.logs', number);           // Log count
ws.set('inv.planks', number);         // Plank count
ws.set('inv.sticks', number);         // Stick count
ws.set('inv.emptySlots', number);     // Free inventory slots

// Equipment
ws.set('has.craftingTable', boolean); // Has crafting table in inventory

// State
ws.set('state.inventoryFull', boolean);
ws.set('state.lastAction', string);
ws.set('state.consecutiveIdleTicks', number);

// Nearby
ws.set('nearby.drops', number);       // Dropped items nearby
ws.set('nearby.chests', number);      // Chests nearby
ws.set('nearby.craftingTables', number);

// Positions
ws.set('pos.bot', Vec3);
ws.set('pos.sharedChest', Vec3 | undefined);
ws.set('pos.sharedCraftingTable', Vec3 | undefined);

// Trade State
ws.set('trade.status', string);       // Current trade phase
ws.set('trade.inTrade', boolean);     // In active trade
ws.set('trade.tradeableCount', number);
ws.set('trade.pendingOffers', number);
ws.set('trade.onCooldown', boolean);
ws.set('trade.isActive', boolean);    // Computed: in an active trade needing completion
ws.set('trade.canRespondToOffers', boolean);  // Computed: can accept offers
ws.set('trade.canBroadcastOffer', boolean);   // Computed: can make offers
```

### Farmer-Specific Facts

```typescript
// Inventory
ws.set('inv.seeds', number);
ws.set('inv.produce', number);

// Equipment
ws.set('has.hoe', boolean);
ws.set('has.sword', boolean);
ws.set('has.axe', boolean);
ws.set('has.sign', boolean);

// Nearby
ws.set('nearby.water', number);
ws.set('nearby.farmland', number);
ws.set('nearby.matureCrops', number);
ws.set('nearby.grass', number);
ws.set('nearby.unknownSigns', number);
ws.set('nearby.hasLumberjack', boolean);      // Lumberjack visible
ws.set('nearby.lumberjackDistance', number);  // Distance to lumberjack (-1 if not visible)

// Positions
ws.set('pos.farmCenter', Vec3 | undefined);

// Capabilities
ws.set('can.till', boolean);
ws.set('can.plant', boolean);
ws.set('can.harvest', boolean);
ws.set('needs.tools', boolean);
ws.set('needs.seeds', boolean);

// Derived
ws.set('derived.hasProduceToDeposit', boolean);
ws.set('derived.canCraftHoe', boolean);
ws.set('derived.needsWood', boolean);
ws.set('derived.hasFarmEstablished', boolean);
ws.set('derived.hasStorageAccess', boolean);
ws.set('derived.hasVillage', boolean);
ws.set('derived.chestRecentlyEmpty', boolean);
ws.set('derived.exploreOnCooldown', boolean);
ws.set('derived.canCraftSign', boolean);

// Sign Knowledge
ws.set('has.studiedSigns', boolean);
ws.set('known.farms', number);
ws.set('known.waterSources', number);
ws.set('pending.signWrites', number);
ws.set('pending.hasFarmSign', boolean);

// Need Delivery
ws.set('need.hasPendingDelivery', boolean);
ws.set('need.deliveryDistance', number);
ws.set('need.deliveryNeedId', string);
```

### Lumberjack-Specific Facts

```typescript
// Inventory
ws.set('inv.saplings', number);

// Equipment
ws.set('has.axe', boolean);
ws.set('has.sign', boolean);
ws.set('has.boat', boolean);

// Nearby
ws.set('nearby.trees', number);
ws.set('nearby.reachableTrees', number);  // Trees at/below bot level
ws.set('nearby.forestTrees', number);     // Trees in verified forests
ws.set('nearby.logs', number);
ws.set('nearby.leaves', number);
ws.set('nearby.unknownSigns', number);

// Positions
ws.set('pos.villageCenter', Vec3 | undefined);

// Capabilities
ws.set('can.chop', boolean);
ws.set('needs.toDeposit', boolean);
ws.set('has.incomingNeeds', boolean);
ws.set('can.spareForNeeds', boolean);

// Derived
ws.set('derived.canCraftAxe', boolean);
ws.set('derived.canCraftSign', boolean);
ws.set('derived.hasStorageAccess', boolean);
ws.set('derived.hasVillage', boolean);
ws.set('derived.needsCraftingTable', boolean);
ws.set('derived.needsChest', boolean);
ws.set('derived.forestSearchRecentlyFailed', boolean);

// Sign Knowledge
ws.set('has.studiedSigns', boolean);
ws.set('has.checkedStorage', boolean);
ws.set('known.chests', number);
ws.set('known.forests', number);
ws.set('has.knownForest', boolean);
ws.set('pending.signWrites', number);
ws.set('pending.hasForestSign', boolean);

// Exploration
ws.set('exploration.waterAhead', number);
ws.set('exploration.minWaterAhead', number);
```

### Landscaper-Specific Facts

```typescript
// Inventory
ws.set('inv.dirt', number);
ws.set('inv.cobblestone', number);
ws.set('inv.slabs', number);

// Equipment
ws.set('has.shovel', boolean);
ws.set('has.pickaxe', boolean);
ws.set('derived.hasAnyTool', boolean);

// Positions
ws.set('pos.villageCenter', Vec3 | undefined);

// Terraform
ws.set('has.pendingTerraformRequest', boolean);
ws.set('terraform.active', boolean);
ws.set('terraform.phase', string);

// Capabilities
ws.set('can.terraform', boolean);
ws.set('needs.tools', boolean);
ws.set('needs.toDeposit', boolean);

// Derived
ws.set('derived.hasStorageAccess', boolean);
ws.set('derived.hasVillage', boolean);
ws.set('derived.canCraftShovel', boolean);
ws.set('derived.canCraftPickaxe', boolean);

// Sign Knowledge
ws.set('has.studiedSigns', boolean);
ws.set('known.farms', number);
ws.set('has.dirtpit', boolean);

// Farm Maintenance
ws.set('state.knownFarmCount', number);
ws.set('state.farmsNeedingCheck', number);
ws.set('state.farmMaintenanceNeeded', boolean);
ws.set('state.farmsWithIssues', number);

// Lumberjack Tracking
ws.set('nearby.hasLumberjack', boolean);
ws.set('nearby.lumberjackDistance', number);
```

## State Reset on Role Change

When switching roles (chat command), state is cleared:

```typescript
// In bot.ts
currentRole?.stop(bot);
blackboard = createBlackboard();  // Fresh state
newRole.start(bot, options);
```

### Why Full Reset?

Farming blackboard has farming-specific data:
- `farmCenter`: Irrelevant to lumberjack
- `nearbyMatureCrops`: Lumberjack doesn't care

Starting fresh ensures no confusion from stale data.
