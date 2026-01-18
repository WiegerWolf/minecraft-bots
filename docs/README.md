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

The bot manager (`src/manager/`) provides an interactive terminal interface for managing multiple bots.

### Layout
```
+----------------------------------------------------------+
|  Minecraft Bot Manager [session-id]     hotReload:off quit|
+------------------+---------------------------------------+
|  BOTS            |  LOGS                    level:INFO   |
|  ┌ Farmer (2)    |  10:22:15 INFO [Farmer] Goal selected |
|  │ > Emma   [R]  |  10:22:16 DEBUG [Lmbr] Chopping tree  |
|  │   Oscar  [S]  |  10:22:17 WARN [Land] No pickaxe...   |
|  ┌ Lmbr (1)      |                                       |
|  │   Carl   [R]  |                                       |
|  ──────────────  |                                       |
|  s x r a d R     |                        l f c          |
+------------------+---------------------------------------+
```

### Keyboard Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| `j`/`k` or arrows | Navigate bot list | Bot panel |
| `s` | Start selected bot | Bot panel |
| `x` | Stop selected bot | Bot panel |
| `r` | Restart selected bot | Bot panel |
| `R` | Restart all bots | Bot panel |
| `a` | Add new bot (session-only) | Bot panel |
| `d` | Delete selected bot | Bot panel |
| `l` | Cycle log level (TRACE→DEBUG→INFO→WARN→ERROR) | Log panel |
| `f` | Toggle log filter (all / selected bot) | Log panel |
| `c` | Clear logs | Log panel |
| `h` | Toggle hot-reload | Header |
| `q` | Quit (stops all bots first) | Header |

### Bot Status Indicators

| Badge | Meaning |
|-------|---------|
| `[R]` | Running |
| `[S]` | Stopped |
| `[C]` | Crashed (will auto-restart with backoff) |
| `[+]` | Starting |
| `[~]` | Restarting |

### Design Decisions

- **Session-only bot changes**: Added/deleted bots are lost when you quit. Keeps config simple.
- **Grouped by role**: Bots are grouped under their role (Farmer, Lmbr, etc.) with count displayed.
- **Contextual shortcuts**: Shortcuts appear near their relevant UI sections.
- **Auto-start on add**: New bots start immediately after being added.
- **Log level filtering**: View-only filter, doesn't affect file logging.

## Quick Reference

### Key Numbers to Remember

| Parameter | Value | Why |
|-----------|-------|-----|
| Tick interval | 100ms | Balance responsiveness vs CPU |
| Hysteresis threshold | 20% | Prevent goal thrashing |
| Goal cooldown | 5 seconds | Allow retry without spam |
| Max consecutive failures | 3 | Fail fast on systematic issues |
| World change threshold | 5 facts | Ignore minor fluctuations |
| Backoff cap | 30 seconds | Don't wait forever |
| Seed threshold | 10 | Comfortable farming buffer |
| Sign search radius | 25 blocks | Area around spawn to find knowledge signs |
| Sign types | VILLAGE, CRAFT, CHEST, FOREST, MINE, FARM, WATER | Infrastructure + landmarks |
| WriteKnowledgeSign utility | 85-120 | High priority, enables other bots to find farms (farmers) |
| StudySpawnSigns utility | 200 | High priority on spawn, before other work (both bots) |
| ReadUnknownSign utility | 45-60 | Low priority curiosity behavior (both bots) |
| Sign crafting materials | 6 planks + 1 stick | ProcessWood can chain to satisfy this |
| Lumberjack tree search | 50/32 blocks | With/without village center (must match blackboard) |
| Full chest memory | 5 minutes | Time before retrying a full chest |
| Trade offer threshold | 4+ items | Minimum unwanted items before offering trade |
| Trade offer cooldown | 30 seconds | Time between trade broadcasts |
| Trade response window | 5 seconds | Time to collect [WANT] responses |
| Trade arrival timeout | 2 minutes | Max time to wait for partner arrival |
| CompleteTrade utility | 150 | Very high - finish active trades first |
| RespondToTrade utility | 70 | Medium-high when wanted offer exists |
| BroadcastTrade utility | 30-50 | Low priority, when idle with clutter |

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
| ItemCategories | `src/shared/ItemCategories.ts` |
| Shared Trade Actions | `src/shared/actions/BaseTrade.ts` |
| Logger | `src/shared/logger.ts` |
| TUI Manager | `src/manager/index.tsx` |
| Old Process Manager | `src/index.ts` |

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

## Contributing to Docs

When modifying the bot:
1. If you change **why** something works, update these docs
2. If you change **how** something works, update code comments
3. Keep the focus on reasoning, not code walkthrough
