# Bot System Documentation

This documentation explains the **reasoning** behind design decisions, not just what the code does. Use these docs to understand *why* things work the way they do.

## Documentation Index

### [Architecture Overview](./architecture.md)
High-level design decisions and trade-offs:
- Why GOAP over behavior trees
- Why Blackboard + WorldState (two state systems)
- Why hysteresis in goal selection
- Why chat-based multi-bot communication
- Why mixin pattern for capabilities

### [GOAP Planning System](./goap-planning.md)
The goal-oriented action planning system in depth:
- The PERCEIVE → DECIDE → ACT → MONITOR loop
- Goal utility functions and conditions
- Action preconditions, effects, and costs
- A* planning algorithm and heuristics
- Plan execution and failure handling
- Debugging tips and common patterns

### [State Management](./state-management.md)
How the bot tracks and reasons about the world:
- Blackboard: perception and memory
- WorldState: facts for planning
- WorldStateBuilder: the translation layer
- Farm center and strategic state
- Memory systems (exploration, bad water, unreachable items)
- Trade state (offers, active trades, item categorization)

### [Multi-Bot Coordination](./multi-bot-coordination.md)
How multiple bots work together:
- The village concept and role specialization
- Chat-based communication protocol
- Resource request/fulfill pattern (chest-based)
- Direct hand-to-hand trading (item exchange)
- Terraform coordination
- Process management and staggered startup

### [Failure Handling](./failure-handling.md)
How the system handles failures at every level:
- Process crashes and exponential backoff
- Planning failures and goal cooldowns
- Action failures and replanning triggers
- World changes and state monitoring
- Pathfinding timeouts and blacklisting
- Zombie detection and graceful shutdown

### [Testing Infrastructure](./testing.md)
How to test bot behavior at different levels:
- MockWorld: deterministic 3D block grid (fast unit tests)
- Simulation tests: real Paper server with actual physics (integration tests)
- Tree builders and preset worlds
- Visualization with prismarine-viewer
- WorldState presets for planning tests
- Best practices for behavioral specs

### TUI Dashboard (below)
Interactive terminal interface for bot management:
- Keyboard-driven bot lifecycle control
- Real-time log viewing with filtering
- Bot grouping by role
- Hot-reload support

## Logging System

The project uses **Pino** for structured logging with dual output:

### Output Destinations
- **Console**: Pretty-printed via `pino-pretty` during development
- **Files**: JSON format in `logs/SESSION_ID/RoleLabel.log` for searchability

### Directory Structure
```
logs/
  2026-01-17_20-44-32/   # Session timestamp (each run)
    Farmer.log           # One file per role (consistent names)
    Lmbr.log
  latest -> ...          # Symlink to most recent session
```

**Why session-based?** During development, running the bot repeatedly would fill date folders with random bot names. Session-based organization keeps each run isolated and easy to navigate.

### Log Levels
| Level | Usage |
|-------|-------|
| `error` | Connection lost, uncaught exceptions |
| `warn` | Recoverable failures, action retries |
| `info` | Role start/stop, goal changes, status updates |
| `debug` | Action ticks, planner iterations, blackboard updates |

### Logger Access Patterns
```typescript
// In GOAP roles (via this.log)
this.log?.info({ goal: goal.name, utility }, 'Goal selected');

// In behavior actions (via bb.log)
bb.log?.debug({ action: 'harvest', count: crops.length }, 'Harvesting crops');

// Creating child loggers
const plannerLog = createChildLogger(logger, 'Planner');
```

### Environment Control
```bash
LOG_LEVEL=debug bun run start farmer  # Set log level
```

## TUI Dashboard

The bot manager (`src/manager/`) provides an interactive terminal interface for managing multiple bots with two views: Overview and Detail.

### Overview Screen (Default)

Full-screen grid of bot cards showing at-a-glance status:
```
+------------------------------------------------------------------+
| Minecraft Bot Manager [session-id]            HotReload:on  quit |
+------------------------------------------------------------------+
| ╭─ Emma_Farmer ────[R]─╮  ╭─ Oscar_Farmer ──[R]─╮                |
| │ Goal: HarvestCrops   │  │ Goal: PlantSeeds    │                |
| │ Act: HarvestCrops    │  │ Act: TillGround     │                |
| │ Stats: 42/45 ok 3 fl │  │ Stats: 18/20 ok 2 fl│                |
| │ Progress: ████░░ 60% │  │ Progress: ██░░░ 40% │                |
| ╰──────────────────────╯  ╰─────────────────────╯                |
+------------------------------------------------------------------+
| ↑↓←→/hjkl navigate  Enter details  s/x/r bot ctrl  a/d add/del  |
+------------------------------------------------------------------+
```

### Detail Screen

Press Enter on a bot to see full details:
```
+------------------------------------------------------------------+
| Emma_Farmer [R]  [session-id]      Esc/Backspace back  s x r     |
+------------------------------------------------------------------+
| Current State                    │ Goal Utilities                |
| Goal: HarvestCrops (75.5)        │   HarvestCrops    75.5 ← CUR  |
| Action: HarvestCrops [3/5]       │   PlantSeeds      45.0        |
| Plan Progress: ████████░░ 60%    │   CollectDrops     0.0 [ZERO] |
|                                  │                               |
| Statistics                       │ Recent Actions                |
| Actions executed: 45             │ 10:23:15 ✓ HarvestCrops       |
| Actions succeeded: 42            │ 10:23:12 ✓ PlantSeeds         |
| Actions failed: 3                │ 10:23:08 ✗ CollectDrops (3x)  |
| Success rate: 93.3%              │                               |
+------------------------------------------------------------------+
```

### Keyboard Shortcuts

**Overview Screen:**
| Key | Action |
|-----|--------|
| `↑↓←→` or `hjkl` | Navigate grid |
| `Enter` | Open detail view |
| `s` / `x` / `r` | Start / Stop / Restart bot |
| `R` | Restart all bots |
| `a` / `d` | Add / Delete bot |
| `H` | Toggle hot-reload |
| `q` | Quit |

**Detail Screen:**
| Key | Action |
|-----|--------|
| `Esc` / `Backspace` | Back to overview |
| `s` / `x` / `r` | Start / Stop / Restart this bot |
| `q` | Quit |

### Bot Status Indicators

| Badge | Meaning |
|-------|---------|
| `[R]` | Running |
| `[S]` | Stopped |
| `[C]` | Crashed (will auto-restart with backoff) |
| `[.]` | Starting or Restarting |

### Design Decisions

- **Overview + Detail pattern**: Quick glance at all bots, drill down for details
- **Grid layout**: Adapts to terminal width, shows more bots on wider terminals
- **Session-only bot changes**: Added/deleted bots are lost when you quit
- **State over logs**: TUI shows live bot state; logs go to files for `/logs` analysis

## Quick Reference

### Key Numbers to Remember

| Parameter | Value | Why |
|-----------|-------|-----|
| Tick interval | 100ms | Balance responsiveness vs CPU |
| Hysteresis threshold | 20% | Prevent goal thrashing |
| Preemption threshold | 30 utility | Allow urgent goals to interrupt RUNNING actions |
| Goal cooldown | 5 seconds | Allow retry without spam |
| Max consecutive failures | 3 | Fail fast on systematic issues |
| World change threshold | 5 facts | Ignore minor fluctuations |
| Backoff cap | 30 seconds | Don't wait forever |
| Seed threshold | 10 | Comfortable farming buffer |
| Sign search radius | 25 blocks | Area around spawn to find knowledge signs |
| Sign types | VILLAGE, CRAFT, CHEST, FOREST, MINE, FARM, WATER | Infrastructure + landmarks |
| WriteKnowledgeSign utility (FARM) | 200-250 | Critical priority - landscapers need farm location to terraform |
| WriteKnowledgeSign utility (other) | 85-120 | High priority for other sign types |
| GetSignMaterials action | Chains with WriteKnowledgeSign | Gets planks/sticks from chest when sign materials needed |
| StudySpawnSigns utility | 200 | High priority on spawn, before other work (both bots) |
| ReadUnknownSign utility | 45-60 | Low priority curiosity behavior (both bots) |
| Sign crafting materials | 6 planks + 1 stick | GetSignMaterials can chain to satisfy this |
| Lumberjack tree search | 50/32 blocks | With/without village center (must match blackboard) |
| FindForest base radius | 32 blocks | Starting exploration distance |
| FindForest radius expansion | +8 blocks/4 attempts | Expands when nearby exhausted (max 80) |
| Exploration memory TTL | 5 minutes | Time before explored area becomes "new" again |
| Cave avoidance penalty | -200 score | Positions without clear sky (prevents cave exploration) |
| Unsafe Y penalty | -100 score | Positions below Y=55 or above Y=85 |
| Min safe exploration Y | 55 | Below this is considered underground/caves |
| Max safe exploration Y | 85 | Above this is considered mountains |
| Max swimming distance | 20 blocks | Water crossing >20 blocks requires a boat (prevents ocean exploration) |
| Full chest memory | 5 minutes | Time before retrying a full chest |
| Trade offer threshold | 4+ items | Minimum unwanted items before offering trade |
| Trade offer cooldown | 30 seconds | Time between trade broadcasts |
| Trade response window | 5 seconds | Time to collect [WANT] responses |
| Trade arrival timeout | 2 minutes | Max time to wait for partner arrival |
| Trade step back distance | 4 blocks | Distance giver moves back after dropping (pickup range is ~2) |
| Trade giver wait after drop | 3 seconds | Time giver waits for receiver confirmation |
| Trade pickup verification wait | 1 second | Time to wait for items to settle before pickup |
| CompleteTrade utility | 150 | Very high - finish active trades first |
| RespondToTrade utility | 120 | High priority - can preempt RUNNING actions (120 > 80 + 30) |
| BroadcastTrade utility | 30-50 | Low priority, when idle with clutter |
| Simulation clear radius | 50 blocks | 100x100 area cleared between tests |
| Simulation clear height | y=60-100 | Clears tall trees |
| Simulation server port | 25566 | Paper server game port |
| Simulation RCON port | 25575 | RCON for world sync |
| RCON throttle | 5ms | Delay between commands to prevent disconnect |

### File Locations

| Component | Location |
|-----------|----------|
| GOAP Planner | `src/planning/GOAPPlanner.ts` |
| Goal Arbiter | `src/planning/GoalArbiter.ts` |
| Plan Executor | `src/planning/PlanExecutor.ts` |
| WorldState | `src/planning/WorldState.ts` |
| WorldStateBuilder | `src/planning/WorldStateBuilder.ts` |
| Farming Blackboard | `src/roles/farming/Blackboard.ts` |
| Lumberjack Blackboard | `src/roles/lumberjack/LumberjackBlackboard.ts` |
| Landscaper Blackboard | `src/roles/landscaper/LandscaperBlackboard.ts` |
| GOAPRole base | `src/roles/GOAPRole.ts` |
| VillageChat | `src/shared/VillageChat.ts` |
| SignKnowledge | `src/shared/SignKnowledge.ts` |
| TerrainUtils | `src/shared/TerrainUtils.ts` |
| ItemCategories | `src/shared/ItemCategories.ts` |
| Shared Trade Actions | `src/shared/actions/BaseTrade.ts` |
| Logger | `src/shared/logger.ts` |
| TUI Manager | `src/manager/index.tsx` |
| Old Process Manager | `src/index.ts` |
| MockWorld | `tests/mocks/MockWorld.ts` |
| BotMock | `tests/mocks/BotMock.ts` |
| World Visualizer | `tests/mocks/visualize-world.ts` |
| PaperSimulationServer | `tests/simulation/PaperSimulationServer.ts` |
| SimulationTest | `tests/simulation/SimulationTest.ts` |

### Debug Commands

Enable debug logging in role configuration:
```typescript
new GOAPFarmingRole({ debug: true, logger })
```

Get goal utilities (logged automatically at debug level):
```typescript
// Logged via: this.log?.debug({ goals: report }, 'Goal utilities')
const report = arbiter.getGoalReport(worldState);
```

Get execution stats:
```typescript
// Logged via: this.log?.info(stats, 'Execution stats')
const stats = executor.getStats();
```

Search log files:
```bash
# Last session's logs
cat logs/latest/*.log | grep "Goal selected"

# All errors from latest session
cat logs/latest/*.log | jq 'select(.level >= 50)'

# Find across all sessions
grep -r "Goal selected" logs/
```

Visualize test worlds:
```bash
# See MockWorld presets in browser (http://localhost:3000)
bun run visualize forest       # 5 oak trees
bun run visualize stump-field  # Only stumps
bun run visualize mixed        # Stumps nearby, forest far
bun run visualize structure    # Wooden building + tree
```

Run simulation tests (real Paper server):
```bash
bun run sim:test        # Automated integration tests
```

## Contributing to Docs

When modifying the bot:
1. If you change **why** something works, update these docs
2. If you change **how** something works, update code comments
3. Keep the focus on reasoning, not code walkthrough
