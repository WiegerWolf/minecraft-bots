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

### File Locations

| Component | Location |
|-----------|----------|
| GOAP Planner | `src/planning/GOAPPlanner.ts` |
| Goal Arbiter | `src/planning/GoalArbiter.ts` |
| Plan Executor | `src/planning/PlanExecutor.ts` |
| WorldState | `src/planning/WorldState.ts` |
| WorldStateBuilder | `src/planning/WorldStateBuilder.ts` |
| Farming Blackboard | `src/roles/farming/Blackboard.ts` |
| GOAPRole base | `src/roles/GOAPRole.ts` |
| VillageChat | `src/shared/VillageChat.ts` |
| Process Manager | `src/index.ts` |

### Debug Commands

Enable debug logging in role configuration:
```typescript
new GOAPFarmingRole({ debug: true })
```

Get goal utilities:
```typescript
console.log(arbiter.getGoalReport(worldState));
```

Get execution stats:
```typescript
console.log(executor.getStats());
```

## Contributing to Docs

When modifying the bot:
1. If you change **why** something works, update these docs
2. If you change **how** something works, update code comments
3. Keep the focus on reasoning, not code walkthrough
