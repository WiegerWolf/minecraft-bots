# Architecture Overview

This document explains the **reasoning** behind the architectural decisions in this Minecraft bot system, not just what the code does.

## Core Philosophy

The bot system evolved from simple behavior trees to a sophisticated GOAP (Goal-Oriented Action Planning) architecture. This wasn't arbitrary - each architectural choice solves specific problems encountered during development.

## Why GOAP Over Behavior Trees?

### The Problem with Behavior Trees

The original FarmingRole used a behavior tree with hardcoded priority ordering:

```
Selector
├── Sequence: Collect Drops
├── Sequence: Harvest Crops
├── Sequence: Plant Seeds
├── ...
```

This worked initially but had critical flaws:

1. **Static priorities**: "Collect drops" was always highest priority, even when the bot had no drops but desperately needed tools
2. **No adaptation**: The tree couldn't recognize that crafting a hoe should take precedence when you have 50 seeds but no way to plant them
3. **Brittle composition**: Adding a new behavior required manually figuring out where it fits in the priority list

### Why GOAP Solves This

GOAP inverts the decision model:

- **Goals compete dynamically** via utility scores that respond to world state
- **The planner finds HOW** to achieve goals automatically via A* search
- **Priorities emerge** from the situation, not from hardcoded ordering

Example: `CollectDropsGoal` has utility `100 + (dropCount * 10)`. When there are 5 drops, utility is 150. But `ObtainToolsGoal` returns 95 when we can craft. So drops win... unless there are zero drops, then tools win. This happens automatically.

## Why Blackboard + WorldState (Two State Systems)?

At first glance, having both `Blackboard` and `WorldState` seems redundant. They serve fundamentally different purposes.

### Blackboard: Perception Layer

The Blackboard is the "sensory cortex" - it answers **"what does the world look like right now?"**

```typescript
interface FarmingBlackboard {
    nearbyWater: Block[];           // Actual block references
    nearbyMatureCrops: Block[];     // Can iterate and act on these
    exploredPositions: ExplorationMemory[];  // Spatial memory
    unreachableDrops: Map<number, number>;   // Temporal memory
}
```

Key insight: **Blackboard holds rich, mutable data** - actual Block objects, position histories, timestamps. Actions need this to do their work.

### WorldState: Planning Layer

WorldState is the "abstract reasoning layer" - it answers **"what facts matter for planning?"**

```typescript
// WorldState just has facts
ws.set('nearby.matureCrops', 12);  // Just a count
ws.set('has.hoe', true);           // Just a boolean
```

Key insight: **WorldState is immutable during planning**. The planner clones it to simulate "what if I do action X?" without corrupting the real state. You can't clone Block objects, but you can clone numbers.

### The Separation Matters Because

1. **Planning safety**: The A* planner explores hundreds of hypothetical states. If it mutated the real Blackboard, chaos would ensue.

2. **Clean abstraction**: Actions think in terms of `nearbyMatureCrops.length > 0` (can I harvest?) while Goals think in terms of `ws.getNumber('nearby.matureCrops')` (how urgent is harvesting?).

3. **Performance**: WorldState only stores planning-relevant facts. The Blackboard stores everything needed for execution.

## Why Hysteresis in Goal Selection?

The GoalArbiter uses a 20% hysteresis threshold:

```typescript
if (bestUtility < currentUtility * 1.2) {
    // Stick with current goal
}
```

### The Problem: Goal Thrashing

Without hysteresis, imagine this scenario:
- HarvestCrops has utility 50
- PlantSeeds has utility 51
- Bot switches to PlantSeeds
- After planting one seed, PlantSeeds is now 49
- Bot switches back to HarvestCrops
- ... infinite loop

### Why 20%?

Trial and error. Lower values (10%) still caused thrashing in edge cases. Higher values (30%) made the bot feel "stubborn" - it wouldn't switch to obviously better goals. 20% balances responsiveness with stability.

## Why Goal Cooldowns After Failure?

When a goal's plan fails, it goes on a 5-second cooldown:

```typescript
this.failedGoalCooldowns.set(goal.name, now + 5000);
```

### The Problem: Failure Loops

Consider: Bot tries to harvest crops, but pathfinding fails (obstacle). Without cooldown:
1. HarvestCrops selected (highest utility)
2. Plan fails
3. HarvestCrops selected again (still highest utility)
4. Plan fails again
5. ... forever

### Why 5 Seconds?

Long enough for:
- Another bot to move out of the way
- Dynamic obstacles (mobs) to wander off
- The world to change enough that a different approach might work

Short enough that the bot doesn't feel unresponsive.

## Why Separate `hadRecentFailures()` Tracking?

The PlanExecutor tracks whether failures occurred during execution:

```typescript
hadRecentFailures(): boolean {
    return this.consecutiveFailures > 0;
}
```

This is used to decide whether to apply cooldown when a plan is exhausted.

### The Nuance

Plan exhaustion has two meanings:
1. **Success**: All actions completed, goal achieved
2. **Partial failure**: Some actions failed, plan gave up

Only case 2 should trigger cooldown. Without `hadRecentFailures()`, the bot would cooldown even successful goals, making it avoid productive work.

## Why Utility Functions Return Variable Scores?

Goals don't just return "high" or "low" - they calculate precise utilities:

```typescript
// CollectDropsGoal
getUtility(ws: WorldState): number {
    const dropCount = ws.getNumber('nearby.drops');
    return Math.min(150, 100 + dropCount * 10);
}
```

### The Problem: Priority Inversion

With fixed priorities:
- 1 drop and 50 mature crops? Still collect drop first (higher priority)
- This is wrong - harvesting 50 crops is more valuable

### Variable Utilities Enable Trade-offs

- 1 drop = utility 110
- 50 mature crops = utility 60 + (50 * 3) = 210

Now crops win, as they should. The math encodes the economic value of each activity.

### Why Those Specific Numbers?

Tuned through observation:
- Drops get high base (100) because despawn is catastrophic
- Per-drop bonus (+10) because more drops = higher urgency
- Cap at 150 because nothing should infinitely dominate
- Crop utility is lower base (60) but scales well because crops don't despawn

## Why A* with Fact-Based Heuristic?

The planner's heuristic estimates cost to reach goal:

```typescript
private heuristic(state: WorldState, goal: Goal): number {
    let totalCost = 0;
    for (const condition of goal.conditions) {
        if (!condition.check(state.get(condition.key))) {
            // Estimate actions needed
            totalCost += estimatedActions * 3;
        }
    }
    return totalCost;
}
```

### Why Not Simple "Unsatisfied Conditions" Count?

The naive heuristic counts unsatisfied conditions. But consider:
- Goal: `inv.logs >= 64`
- Current logs: 4
- Naive heuristic: 1 (one unsatisfied condition)
- Better heuristic: (64-4)/4 = 15 (estimated ChopTree actions)

The distance-aware heuristic makes A* expand fewer nodes because it better estimates true cost.

## Why `numericTarget` Metadata on Conditions?

Goal conditions carry extra metadata:

```typescript
numericGoalCondition('inv.seeds', v => v >= 10, 'sufficient seeds', {
    value: 10,
    comparison: 'gte',
    estimatedDelta: 5  // Seeds gained per GatherSeeds action
})
```

### The Problem: Heuristic Blindness

Without this metadata, the planner can't estimate how many actions are needed. It might try 1 GatherSeeds when 3 are needed, leading to failed plans and replanning.

### The Solution

`estimatedDelta` tells the heuristic "each action gets ~5 seeds". Now it can calculate: need 10, have 0, delta 5 → estimate 2 actions. Better plans, fewer failures.

## Why Chat-Based Multi-Bot Communication?

Bots communicate via Minecraft chat messages:

```typescript
// Announce shared chest location
this.bot.chat(`[CHEST] shared ${x} ${y} ${z}`);
```

### Alternatives Considered

1. **Shared file**: Works but requires file locking, prone to race conditions
2. **Redis/database**: Overkill, adds infrastructure dependency
3. **Direct TCP**: Complex, requires port management

### Why Chat?

- **Already exists**: Minecraft chat is free infrastructure
- **Naturally async**: Messages are broadcast, no request-response needed
- **Observable**: You can watch bot coordination in the game
- **Resilient**: If a bot crashes, others continue without hangs

### Limitations

256-character message limit requires careful encoding. Complex data structures can't be communicated (by design - keeps coordination simple).

## Why Ink for the TUI Dashboard?

The bot manager uses **Ink** (React for CLIs) to provide an interactive terminal interface.

### Alternatives Considered

1. **blessed/blessed-contrib**: Powerful but complex, imperative API
2. **inquirer/prompts**: Great for Q&A flows, not for dashboards
3. **Raw ANSI codes**: Maximum control but maintenance nightmare
4. **ncurses bindings**: C-style API, poor TypeScript support

### Why Ink?

- **React mental model**: Components, hooks, state - familiar patterns
- **Declarative UI**: Describe what you want, not how to render it
- **Flexbox layout**: `<Box flexDirection="column">` just works
- **Hooks for input**: `useInput()` handles keyboard elegantly
- **Hot-reloadable**: Development feels like web React

### Why React Hooks for State?

The TUI uses standard React patterns:
```typescript
const [selectedIndex, setSelectedIndex] = useState(0);
const [logLevelIndex, setLogLevelIndex] = useState(2); // INFO
```

This keeps state management simple and predictable. Complex state (like bot processes) lives in custom hooks (`useBotManager`) that encapsulate lifecycle logic.

### Why Contextual Shortcuts?

Keyboard shortcuts appear near their relevant UI sections:
- Bot actions (`s`/`x`/`r`) in the bot panel footer
- Log controls (`l`/`f`/`c`) in the log panel header
- Global actions (`h`/`q`) in the main header

This reduces cognitive load - users see what actions are available where they're looking.

## Why Exponential Backoff for Crashes?

The process manager (in `src/manager/hooks/useBotManager.ts`) uses exponential backoff:

```typescript
const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, attempts), MAX_BACKOFF);
// 1s → 2s → 4s → 8s → 16s → 30s (capped)
```

### The Problem: Crash Loops

If the server is down:
1. Bot crashes
2. Instant restart
3. Bot crashes again
4. ... 100 times per second, log spam, CPU usage

### Why Exponential?

- Fast recovery when crashes are transient (1 second)
- Backs off when something is persistently wrong
- Cap at 30 seconds prevents absurdly long waits

### Why Reset on Success?

```typescript
if (text.includes("✅ Bot has spawned!")) {
    reconnectAttempts.set(configKey, 0);
}
```

Once the bot successfully spawns, the problem is solved. Reset to 0 so the next crash gets fast recovery.

## Why `isBotConnected()` Checks Socket State?

The GOAP role checks connection health:

```typescript
private isBotConnected(): boolean {
    const client = (this.bot as any)._client;
    return client && !client.socket.destroyed && this.bot.entity;
}
```

### The Problem: Zombie Bots

Mineflayer can enter a state where:
- The bot object exists
- Event handlers are attached
- But the TCP socket is dead

The bot appears alive but can't actually do anything. The tick loop runs, burning CPU, accomplishing nothing.

### Why These Specific Checks?

- `client.socket.destroyed`: Direct socket health
- `this.bot.entity`: Confirms we're spawned in-world

Both must be true for the bot to be functional.

## Why Separate Action Costs?

Actions have different planning costs:

```typescript
PickupItems: 0.5
HarvestCrops: 1.0
TillGround: 2.0
CraftHoe: 4.0
Explore: 10.0
```

### The Problem: Plan Quality

Without costs, A* would just find ANY plan. But not all plans are equal:
- Pickup items then harvest is better than explore then harvest
- Lower-cost plans execute faster and more reliably

### Why These Specific Values?

Based on real-world execution:
- Picking up items is nearly instant (0.5)
- Crafting is multi-step and can fail (4.0)
- Exploration is expensive and unpredictable (10.0)

The numbers encode both time and reliability.

## Why Mixin Pattern for Capabilities?

Mixins add capabilities:

```typescript
class FarmingRole extends ResourceMixin(CraftingMixin(KnowledgeMixin(Object))) {
    // Now has findNaturalBlock(), craftItem(), rememberPOI()
}
```

### Alternatives Considered

1. **Inheritance**: Deep inheritance hierarchies are brittle
2. **Composition**: Requires explicit delegation boilerplate
3. **Dependency injection**: Adds runtime complexity

### Why Mixins?

- **Flat**: No deep hierarchies
- **Composable**: Mix and match capabilities per role
- **TypeScript-native**: Full type checking on mixed-in methods

### Limitation

Can't easily override mixed-in methods. If two mixins provide same method name, last one wins. Design mixins with distinct responsibilities.

## Why Pino for Logging?

The system uses **Pino** for structured logging with dual output:

```typescript
const logger = createBotLogger({ botName: 'DevFarmer', role: 'goap-farming' });
logger.info({ goal: 'HarvestCrops', utility: 75 }, 'Goal selected');
```

### Alternatives Considered

1. **console.log**: No structure, no levels, no file output
2. **Winston**: Popular but heavier, slower JSON serialization
3. **Bunyan**: Similar to Pino but less actively maintained
4. **Custom logger**: Reinventing the wheel

### Why Pino?

- **Fast**: 5x faster than Winston due to optimized JSON serialization
- **JSON-native**: Logs are structured data, not strings
- **pino-pretty**: Readable console output during development
- **Child loggers**: Component isolation without config overhead
- **Bun-compatible**: Works with Bun runtime without issues

### Why Dual Output?

Logs go to both console and files:

```
stdout → pino-pretty → colored, human-readable
files  → JSON → grep-able, searchable
```

**Console for development**: You're watching the bot, you need readable output.

**Files for debugging**: When something went wrong 2 hours ago, you need searchable structured logs.

### Why Logger Per Bot?

Each bot gets its own logger and log file:

```
logs/2024-01-15/
  Emma_Farmer.log
  Oscar_Lmbr.log
  DevFarmer.log
```

Multi-bot runs would produce interleaved output. Separate files let you:
- `tail -f logs/*/DevFarmer.log` to watch one bot
- `grep "Goal selected" logs/*/Emma_Farmer.log` to analyze one bot
- `cat logs/*/*.log | jq 'select(.goal == "HarvestCrops")'` to search all bots

### Why `bb.log` in Behavior Actions?

Behavior actions receive the logger via the blackboard:

```typescript
async tick(bot: Bot, bb: Blackboard): Promise<BehaviorStatus> {
    bb.log?.debug({ action: 'harvest' }, 'Starting harvest');
}
```

**Not constructor injection** because behavior nodes are instantiated once and reused.

**Not global logger** because each bot needs its own logger instance.

**Via blackboard** because it's already the shared context passed to every tick.

### Why Optional Chaining (`bb.log?.`)?

Loggers are optional throughout the codebase:

```typescript
bb.log?.debug('message');  // Not bb.log.debug('message')
```

This allows:
- Running without logging (tests, minimal setups)
- Gradual migration (not everything has logger access yet)
- No crashes if logger initialization fails

### Log Levels Strategy

| Level | When to Use |
|-------|-------------|
| `error` | Unrecoverable failures, connection lost |
| `warn` | Recoverable failures, action retries |
| `info` | Goal changes, role start/stop, deposits |
| `debug` | Action ticks, planner iterations |

**Rule of thumb**: If you'd want to see it in production, use `info`. If it's only useful while actively debugging, use `debug`.
