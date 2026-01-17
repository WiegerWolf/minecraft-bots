# Multi-Bot Coordination

This document explains how multiple bots work together and why the coordination system is designed this way.

## The Village Concept

Bots form a "village" - a cooperative community where each bot has a specialized role:

```
┌─────────────────────────────────────────────────────────────┐
│                         Village                              │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Farmer  │    │Lumberjack│    │Landscaper│              │
│  │          │    │          │    │          │              │
│  │ Grows    │    │ Chops    │    │ Flattens │              │
│  │ food     │    │ trees    │    │ terrain  │              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│       └───────────────┼───────────────┘                     │
│                       │                                     │
│                       ▼                                     │
│              ┌────────────────┐                             │
│              │  Shared Chest  │                             │
│              │                │                             │
│              │ logs, planks   │                             │
│              │ wheat, seeds   │                             │
│              │ dirt, stone    │                             │
│              └────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

## Why Specialized Roles?

### The Alternative: Generalist Bots

We could have each bot do everything. Problems:
1. **Resource contention**: Three bots harvesting same crop = two get nothing
2. **Duplication**: All three crafting hoes when one would suffice
3. **Interference**: Landscaper digging where farmer is planting

### Specialization Benefits

Each bot has clear responsibilities:
- **Farmer**: Grows crops, needs wood for tools
- **Lumberjack**: Harvests wood, deposits excess in shared storage
- **Landscaper**: Modifies terrain on request

This creates:
- **Clear ownership**: Only farmer touches crops
- **Natural dependencies**: Farmer needs lumberjack's wood
- **Request-based coordination**: Farmer asks landscaper for terrain work

## Communication via Chat

### Why Minecraft Chat?

We considered several approaches:

**Shared file (village.json)**:
- Pro: Simple, persistent
- Con: File locking, race conditions, no real-time updates

**Database/Redis**:
- Pro: Robust, real-time
- Con: Infrastructure dependency, overkill for local play

**Direct TCP sockets**:
- Pro: Fast, reliable
- Con: Port management, firewall issues, complex setup

**Minecraft chat**:
- Pro: Already exists, observable in-game, naturally async
- Con: 256 char limit, parsing required

We chose chat because it requires zero infrastructure and you can watch coordination happen in the game.

### Message Protocol

```typescript
// Structured messages with prefixes
[VILLAGE] center <x> <y> <z>      // Village center announcement
[CHEST] shared <x> <y> <z>        // Shared chest location
[CRAFTING] shared <x> <y> <z>     // Shared crafting table
[REQUEST] <item> <quantity>        // Resource request
[FULFILL] <item> <qty> for <bot>   // Request fulfilled
[DEPOSIT] <item> <quantity>        // Deposit notification
[TERRAFORM] <x> <y> <z>            // Terraform request
[TERRAFORM_CLAIM] <x> <y> <z>      // Claim terraform task
[TERRAFORM_DONE] <x> <y> <z>       // Terraform complete
```

### Why Prefix Format?

```typescript
if (message.startsWith('[VILLAGE] center ')) {
    const match = message.match(/\[VILLAGE\] center (-?\d+) (-?\d+) (-?\d+)/);
    ...
}
```

Prefixes enable:
- **Filtering**: Ignore non-village messages (player chat)
- **Routing**: Different handlers for different message types
- **Extensibility**: Add new message types without breaking existing ones

### Why Coordinates as Integers?

```typescript
`[CHEST] shared ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`
```

- **Shorter**: Saves characters in 256 char limit
- **Sufficient**: Block positions don't need decimals
- **Parseable**: `parseInt()` is robust

## The VillageChat Class

### State Tracking

```typescript
interface VillageChatState {
    villageCenter: Vec3 | null;
    sharedChest: Vec3 | null;
    sharedCraftingTable: Vec3 | null;
    pendingRequests: ResourceRequest[];
    pendingTerraformRequests: TerraformRequest[];
}
```

Each bot maintains its own view of village state, synchronized via chat messages.

### Why Duplicate State?

Why not have one "master" bot?

1. **Resilience**: If master crashes, slaves lose coordination
2. **Complexity**: Master election, failover logic
3. **Latency**: Slaves must query master for every decision

With duplicated state:
- Each bot acts independently on its copy
- Chat messages eventually sync everyone
- Temporary inconsistency is acceptable

### Listening to Chat

```typescript
constructor(bot: Bot) {
    this.bot = bot;
    this.setupChatListener();
}

private setupChatListener() {
    this.bot.on('chat', (username: string, message: string) => {
        if (username === this.bot.username) return;  // Ignore own messages

        if (message.startsWith('[VILLAGE] center ')) {
            const match = message.match(...);
            if (match) {
                this.state.villageCenter = new Vec3(...);
            }
        }
        // ... more message handlers
    });
}
```

### Why Ignore Own Messages?

```typescript
if (username === this.bot.username) return;
```

Without this:
1. Bot sends `[CHEST] shared 100 64 200`
2. Bot receives its own message
3. Bot processes it, possibly duplicating work

## Resource Requests

### The Request Flow

```
Farmer                  Lumberjack               Shared Chest
   │                         │                         │
   │ No wood for hoe!        │                         │
   │                         │                         │
   ├──[REQUEST] logs 8──────►│                         │
   │                         │                         │
   │                    Has logs? Yes                  │
   │                         │                         │
   │                         ├────deposits logs───────►│
   │                         │                         │
   │◄──[DEPOSIT] logs 8──────┤                         │
   │                         │                         │
   │ Check shared chest      │                         │
   │                         │                         │
   ├────────────────────────────withdraw logs─────────►│
   │                         │                         │
   │ Craft hoe!              │                         │
```

### Why Request/Deposit Pattern?

**Alternative: Direct handoff**
- Lumberjack finds farmer
- Drops items at farmer's feet
- Farmer picks up

Problems:
- Requires pathfinding to moving target
- What if farmer is busy?
- What if farmer moved?

**Chest-based exchange**:
- Lumberjack deposits to known location
- Farmer withdraws at convenience
- No synchronization required

### Request Deduplication

```typescript
const isDupe = this.state.pendingRequests.some(r =>
    r.from === request.from &&
    r.item === request.item &&
    Date.now() - r.timestamp < 30000
);
if (!isDupe) {
    this.state.pendingRequests.push(request);
}
```

**Why 30 second window?**

- Too short: Same request sent twice in rapid succession creates duplicates
- Too long: Legitimate re-request after failure gets ignored

30 seconds balances these concerns.

### Request Expiration

```typescript
cleanupOldRequests(maxAge: number = 60000) {
    const now = Date.now();
    this.state.pendingRequests = this.state.pendingRequests.filter(r =>
        now - r.timestamp < maxAge
    );
}
```

**Why expire requests?**

Without expiration:
1. Farmer requests logs
2. Farmer crashes
3. Request sits forever
4. Lumberjack keeps trying to fulfill abandoned request

60 second timeout lets abandoned requests die.

## Terraform Coordination

Terraforming is complex because it involves:
1. Farmer identifying need
2. Landscaper doing work
3. Farmer resuming when done

### The Terraform Protocol

```
Farmer                  Landscaper
   │                         │
   │ Terrain is rough!       │
   │                         │
   ├─[TERRAFORM] 100 64 200─►│
   │                         │
   │                    Pending...
   │                         │
   │◄─[TERRAFORM_CLAIM] ...──┤
   │                         │
   │ Wait for completion     │
   │                    Digging...
   │                    Filling...
   │                         │
   │◄─[TERRAFORM_DONE] ...───┤
   │                         │
   │ Resume farming!         │
```

### Why Claim/Done Phases?

**Without claiming**:
- Multiple landscapers might start same task
- Wasted effort, potential conflicts

**With claiming**:
- First to claim wins
- Others skip that task, find other work

### Why Release Mechanism?

```typescript
releaseTerraformClaim(pos: Vec3) {
    // Set status back to 'pending'
    this.bot.chat(`[TERRAFORM_RELEASE] ...`);
}
```

If landscaper claims but fails:
1. Release the claim
2. Status returns to 'pending'
3. Another landscaper (or same one later) can try

Without this, failed claims would block tasks forever.

## Village Center Establishment

### First Bot Wins

```typescript
announceVillageCenter(pos: Vec3): boolean {
    if (this.state.villageCenter) {
        return false;  // Already have one
    }
    this.state.villageCenter = pos;
    this.bot.chat(`[VILLAGE] center ...`);
    return true;
}
```

**Why first-come-first-served?**

- No election protocol needed
- Natural race resolution via chat ordering
- Deterministic: same world → same center

### Why Single Village Center?

Bots need a common reference point:
- "Return to village" makes sense
- Shared chest should be near center
- New bots know where to go

Multiple centers would fragment the village.

## Shared Infrastructure

### Shared Chest Discovery

```typescript
// When lumberjack places a chest
announceSharedChest(pos: Vec3) {
    this.state.sharedChest = pos;
    this.bot.chat(`[CHEST] shared ...`);
}

// Other bots learn about it
if (message.startsWith('[CHEST] shared ')) {
    this.state.sharedChest = parsePosition(message);
}
```

**Why announce placement?**

Without announcements:
- Each bot searches for chests
- Might find different chests
- No coordination on WHERE to deposit/withdraw

With announcements:
- One chest is designated "shared"
- All bots use the same one
- Reliable handoff point

### Shared Crafting Table

Same pattern. Ensures bots don't each place their own table, wasting resources.

## Process Management

### Staggered Startup

```typescript
for (const config of BOT_CONFIGS) {
    await startBot(config);
    await sleep(2000);  // 2 second delay between bots
}
```

**Why stagger?**

If all bots connect simultaneously:
- Server gets hammered
- Some connections might fail
- Race conditions in village establishment

2 second delay gives each bot time to:
- Connect
- Spawn
- Establish village center (first bot)
- Receive village center (other bots)

### Name Generation

```typescript
function generateBotName(roleLabel: string): string {
    const firstName = faker.person.firstName();
    return `${firstName}_${roleLabel}`;  // "Emma_Farmer"
}
```

**Why random names?**

- **Uniqueness**: Multiple sessions don't conflict
- **Readability**: "Emma" is nicer than "Bot_001"
- **Role visibility**: "_Farmer" suffix shows purpose

**Why 16 character limit?**

Minecraft username limit. Exceeding it causes connection failures.

### Per-Bot Output Prefixing

```typescript
const prefixedText = text.split('\n')
    .map(line => line ? `[${config.roleLabel}] ${line}` : '')
    .join('\n');
```

**Why prefix?**

Three bots printing interleaved output:
```
Found water!
Chopping tree...
Flattening terrain...
```

Which bot said what? With prefixes:
```
[Farmer] Found water!
[Lmbr] Chopping tree...
[Land] Flattening terrain...
```

## Coordination Patterns

### Producer-Consumer

```
Lumberjack (Producer)          Farmer (Consumer)
         │                            │
    Chop trees                   Needs wood
         │                            │
         ▼                            │
   ┌─────────┐                        │
   │ Shared  │◄───────────────────────┤
   │ Chest   │         Withdraw       │
   └─────────┘                        │
```

Lumberjack produces wood, farmer consumes it. Chest decouples them temporally.

### Request-Response

```
Farmer                     Lumberjack
   │                            │
   ├──[REQUEST] logs 8─────────►│
   │                            │
   │       (lumberjack works)   │
   │                            │
   │◄──[DEPOSIT] logs 8─────────┤
   │                            │
```

Farmer requests, lumberjack fulfills. Chat messages are the "API."

### Task Queue (Terraform)

```
Terraform Queue                 Landscapers
   │                                │
   ├──Request at (100, 64, 200)     │
   ├──Request at (150, 64, 220)────►│ Claims (100, 64, 200)
   ├──Request at (180, 64, 240)     │
   │                                │
   │◄─────────────Done──────────────┤
   │                                │
   ├──Request at (150, 64, 220)────►│ Claims (150, 64, 220)
   ...
```

Multiple requests queue up. Landscapers claim and process.

## Failure Handling

### Bot Crash Recovery

When a bot crashes:
1. Process manager restarts it
2. Bot reconnects with fresh state
3. Chat messages re-sync village state

**Why this works**:
- Other bots keep running
- Village state persists via chat
- New bot catches up from announcements

### Stale Request Cleanup

```typescript
// Called periodically
villageChat.cleanupOldRequests(60000);
villageChat.cleanupOldTerraformRequests(600000);
```

**Why different timeouts?**

- Resource requests: 60 seconds (fast operations)
- Terraform requests: 10 minutes (slow operations)

## Sign-Based Persistent Knowledge

Chat-based coordination has a limitation: when bots disconnect or die, they lose all knowledge. The sign system solves this.

### The Problem

Without persistence:
1. Lumberjack establishes village, places chest and crafting table
2. Lumberjack dies or disconnects
3. Lumberjack respawns with fresh state
4. Lumberjack has no idea where infrastructure is
5. Lumberjack creates duplicate chest/table elsewhere

### The Solution: Signs at Spawn

Minecraft signs persist in the world. Bots write infrastructure coordinates to signs near spawn:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [VILLAGE]  │  │   [CRAFT]   │  │   [CHEST]   │
│   X: 142    │  │   X: 144    │  │   X: 146    │
│   Y: 64     │  │   Y: 64     │  │   Y: 64     │
│   Z: -89    │  │   Z: -87    │  │   Z: -88    │
└─────────────┘  └─────────────┘  └─────────────┘
```

### How It Works

**On Infrastructure Creation:**
```typescript
// After placing crafting table
bb.pendingSignWrites.push({
    type: 'CRAFT',
    pos: craftingTablePos.clone()
});
```

**GOAP Goal Activation:**
- `WriteKnowledgeSignGoal` activates when `pendingSignWrites > 0`
- Utility 55-65 (medium priority, after critical tasks)
- Bot navigates to spawn, crafts signs if needed, places and writes

**On Bot Spawn:**
```typescript
// In GOAPLumberjackRole.start()
const knowledge = readSignsAtSpawn(bot, spawnPosition, this.log);

if (knowledge.has('VILLAGE')) {
    bb.villageCenter = knowledge.get('VILLAGE');
}
if (knowledge.has('CRAFT')) {
    bb.sharedCraftingTable = knowledge.get('CRAFT');
}
```

### Why Signs?

**Alternative: External file**
- Pro: Simple, reliable
- Con: Not visible in-game, external dependency

**Alternative: Named entities (armor stands)**
- Pro: Could store in name
- Con: Complex to place/read, might despawn

**Signs**:
- In-world: visible to players
- Persistent: survive restarts
- Simple API: `getSignText()`, `updateSign()`
- Natural: players use signs for notes too

### Sign Format

```
[TYPE]
X: <integer>
Y: <integer>
Z: <integer>
```

**Why this format?**
- 4 lines fit sign constraints (~15 chars each)
- Parseable with simple regex
- Human-readable for debugging
- Type prefix enables multiple knowledge types

### Verification on Load

```typescript
const craftingPos = knowledge.get('CRAFT');
if (craftingPos) {
    const block = bot.blockAt(craftingPos);
    if (block && block.name === 'crafting_table') {
        bb.sharedCraftingTable = craftingPos;
    } else {
        this.log?.warn('Crafting table from sign no longer exists');
    }
}
```

Signs might reference blocks that were destroyed. Bot verifies before trusting.

### Sign Placement Strategy

Signs are placed in a grid near spawn:
```typescript
const baseX = spawnPos.x + 2;  // Offset from spawn
const positions = [
    (baseX, Y, Z),      // VILLAGE
    (baseX, Y, Z+1),    // CRAFT
    (baseX, Y, Z+2),    // CHEST
];
```

**Why offset from spawn?**
- Don't block spawn point
- Predictable location for reading
- Grouped together for visibility

## Current Limitations

### No Real Conflict Resolution

If two landscapers claim simultaneously, both might start working. The chat protocol doesn't have atomic claim.

**Acceptable because**:
- Rare in practice
- Worst case: duplicate work, not corruption

### Limited Bandwidth

256 character chat limit restricts:
- No complex data structures
- No bulk updates
- Position precision limited

**Mitigations**:
- Keep messages simple
- Multiple messages for complex data
- Use integers, not floats

### No Authentication

Any player could send fake `[VILLAGE]` messages. Bots would follow malicious commands.

**Acceptable for**:
- Local play
- Trusted servers

**Would need for production**:
- Message signing
- Whitelist of bot usernames
