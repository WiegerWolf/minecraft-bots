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
    reason?: string;
}

bb.exploredPositions = [
    { position: Vec3(100, 64, 200), timestamp: 1705123456789, reason: 'visited' },
    ...
];
```

**Why track exploration?**

Without it, the explore action might:
1. Walk 32 blocks north
2. Walk 32 blocks south (back to start)
3. Walk 32 blocks north again
4. ...

Memory ensures "go somewhere new."

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
