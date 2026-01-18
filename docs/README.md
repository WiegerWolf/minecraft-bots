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

### [Multi-Bot Coordination](./multi-bot-coordination.md)
How multiple bots work together:
- The village concept and role specialization
- Chat-based communication protocol
- Resource request/fulfill pattern
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
| WriteKnowledgeSign utility | 55-65 | Medium priority, after critical tasks (lumberjack) |
| StudySpawnSigns utility | 200 | High priority on spawn, before other work (both bots) |
| ReadUnknownSign utility | 45-60 | Low priority curiosity behavior (both bots) |
| Sign crafting materials | 6 planks + 1 stick | ProcessWood can chain to satisfy this |
| Lumberjack tree search | 50/32 blocks | With/without village center (must match blackboard) |
| Full chest memory | 5 minutes | Time before retrying a full chest |

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
| GOAPRole base | `src/roles/GOAPRole.ts` |
| VillageChat | `src/shared/VillageChat.ts` |
| SignKnowledge | `src/shared/SignKnowledge.ts` |
| Logger | `src/shared/logger.ts` |
| Process Manager | `src/index.ts` |

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
