# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

**Read the `docs/` folder** for in-depth understanding of design decisions:

- [`docs/README.md`](docs/README.md) - Index and quick reference
- [`docs/architecture.md`](docs/architecture.md) - Why GOAP over behavior trees, why two state systems, key trade-offs
- [`docs/goap-planning.md`](docs/goap-planning.md) - Planning loop, goals, actions, A* algorithm
- [`docs/state-management.md`](docs/state-management.md) - Blackboard vs WorldState, memory systems
- [`docs/multi-bot-coordination.md`](docs/multi-bot-coordination.md) - Village chat protocol, role specialization
- [`docs/failure-handling.md`](docs/failure-handling.md) - Recovery strategies at every level

**When modifying code:**
1. Check relevant docs to understand *why* things work the way they do
2. If you discover new insights or change design decisions, update the docs
3. Focus on capturing reasoning, not code walkthroughs

## Commands

- **Run all bots**: `bun run start` (uses `src/index.ts` manager)
- **Run single bot**: `bun run start farmer` / `lumberjack` / `landscaper`
- **Development mode**: `bun run dev:farmer` / `dev:lumberjack` / `dev:landscaper`
- **Type check**: `bunx tsc --noEmit`

## Logging

The project uses **Pino** for structured logging:

- **Console output**: Pretty-printed via `pino-pretty`
- **File output**: JSON logs in `logs/SESSION_ID/RoleLabel.log`
- **Log levels**: `error`, `warn`, `info`, `debug` (controlled via `LOG_LEVEL` env var)

### Log Directory Structure

```
logs/
  2026-01-17_20-44-32/   # Session timestamp (sortable)
    Farmer.log           # One file per role
    Lmbr.log
    Land.log
  2026-01-17_20-45-10/   # Next session
    Farmer.log
  latest -> 2026-01-17_20-45-10/  # Symlink to most recent
```

**Why session-based?** During development, running the bot repeatedly would fill date folders with random bot names. Session-based organization keeps each run isolated and easy to navigate.

### Logger Patterns

```typescript
// In GOAP roles - use this.log
this.log?.info({ goal: goal.name }, 'Goal selected');

// In behavior actions - use bb.log (from blackboard)
bb.log?.debug({ action: 'harvest' }, 'Starting harvest');

// Create child loggers for components
const plannerLog = createChildLogger(logger, 'Planner');
```

### Searching Logs

```bash
# Last session's logs
cat logs/latest/*.log | grep "Goal selected"

# All errors from latest session
cat logs/latest/*.log | jq 'select(.level >= 50)'

# Find specific events across all sessions
grep -r "Goal selected" logs/

# List recent sessions
ls -t logs/ | head -5

# Compare two sessions
diff <(cat logs/2026-01-17_20-44-32/Farmer.log | jq .msg) \
     <(cat logs/2026-01-17_20-45-10/Farmer.log | jq .msg)
```

## Architecture

This is a Minecraft bot built with mineflayer and Bun. The bot connects to a local server and performs autonomous farming tasks.

### Entry Points

- `src/index.ts` - Hot-reload manager that spawns and monitors the bot process, auto-restarts on file changes or crashes with exponential backoff
- `src/bot.ts` - Main bot instance, handles chat commands (`farm`, `come`), graceful shutdown with inventory drop

### Role System

The bot uses a **Role** pattern for different behaviors. Roles implement the `Role` interface (`src/roles/Role.ts`) with `start()` and `stop()` methods.

**FarmingRole** (`src/roles/farming/FarmingRole.ts`) is the primary role, implementing a behavior tree architecture:

1. **Blackboard** (`Blackboard.ts`) - Shared perception/state updated each tick:
   - World perception: nearby water, farmland, crops, grass, drops, chests
   - Inventory analysis: tools, seeds, produce, crafting materials
   - Computed booleans: `canTill`, `canPlant`, `canHarvest`, `needsTools`, `needsSeeds`
   - Strategic state: `farmCenter` (auto-discovered near water)

2. **BehaviorTree** (`BehaviorTree.ts`) - Priority-based task selection:
   - Composite nodes: `Selector` (try children until one succeeds), `Sequence` (run all children in order)
   - Condition nodes: instant checks against blackboard state
   - Action nodes: `PickupItems`, `HarvestCrops`, `PlantSeeds`, `TillGround`, `GatherSeeds`, `CraftHoe`, `GatherWood`, `DepositItems`, `Explore`

3. **Main loop** (100ms tick):
   - PERCEIVE: Update blackboard with world state
   - DECIDE & ACT: Tick behavior tree
   - WAIT: 100ms delay

### Mixins

Reusable capabilities added via TypeScript mixins:

- **ResourceMixin** - Block finding, chunk-aware exploration with history tracking
- **CraftingMixin** - 2x2/3x3 recipe crafting, crafting table placement, POI integration
- **KnowledgeMixin** - Point-of-interest memory (crafting tables, chests, farm centers)

### Task System (Legacy)

`src/roles/farming/tasks/` contains an older task-based system with `WorkProposal` priority scheduling. The behavior tree approach in `BehaviorTree.ts` is the current implementation.

## Key Libraries

- `mineflayer` - Minecraft bot framework
- `mineflayer-pathfinder` - A* pathfinding with goals (`GoalNear`, `GoalLookAtBlock`)
- `vec3` - 3D vector math
- `prismarine-*` - Minecraft data types (blocks, entities, items)

## Bot Behavior

The farming bot autonomously:
1. Discovers farm areas near water sources
2. Gathers tools (crafts hoe from wood if needed)
3. Tills soil, plants seeds, harvests mature crops
4. Collects dropped items, deposits produce in chests
5. Explores for resources when idle

## Keeping Documentation Current

The `docs/` folder captures the **reasoning** behind design decisions. When working on this codebase:

### When to Update Docs

- **Changing thresholds/constants**: Update `docs/README.md` quick reference table
- **Modifying GOAP goals/actions**: Update `docs/goap-planning.md` with new utility formulas or action patterns
- **Changing state management**: Update `docs/state-management.md` if blackboard fields or WorldState facts change
- **Modifying bot coordination**: Update `docs/multi-bot-coordination.md` for new chat protocols or role changes
- **Adding failure handling**: Update `docs/failure-handling.md` with new recovery mechanisms

### What to Document

Document the **why**, not the **what**:
- Bad: "The threshold is 5"
- Good: "The threshold is 5 because lower values caused thrashing and higher values made the bot unresponsive"

### Key Numbers to Keep in Sync

If you change these values, update `docs/README.md`:
- Tick interval (currently 100ms)
- Hysteresis threshold (currently 20%)
- Goal cooldown (currently 5 seconds)
- Max consecutive failures (currently 3)
- World change threshold (currently 5 facts)
- Backoff cap (currently 30 seconds)
