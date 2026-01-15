# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Run bot with hot-reload**: `bun run start` (uses `src/index.ts` manager)
- **Run bot directly (no hot-reload)**: `bun run dev` (uses `bun --watch src/bot.ts`)
- **Type check**: `bunx tsc --noEmit`

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
