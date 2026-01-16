# GOAP/HTN Planning System

## Overview

This bot now includes a **Goal-Oriented Action Planning (GOAP)** system enhanced with **Hierarchical Task Network (HTN)** decomposition. This replaces the static behavior tree with a dynamic, adaptive planning system that can:

- **Dynamically select goals** based on utility scoring (not fixed priorities)
- **Plan optimal action sequences** using A* search
- **Replan automatically** when the world changes or actions fail
- **Decompose complex tasks** using HTN methods
- **Coordinate with multiple bots** (foundation ready for Phase 5-6 enhancements)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      GOAPFarmingRole                         │
│  (Main loop: PERCEIVE → DECIDE → ACT → MONITOR)             │
└─────────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │Blackboard│    │WorldState│    │  Planner │
  │          │───▶│ Builder  │───▶│          │
  └──────────┘    └──────────┘    └──────────┘
   (Perception)                          │
                                         ▼
                                   ┌──────────┐
                                   │  Arbiter │ ◀── Goals
                                   └──────────┘
                                         │
                                         ▼
                                   ┌──────────┐
                                   │ Executor │ ◀── Actions
                                   └──────────┘
```

## Using the GOAP System

### Running with GOAP

Set the `BOT_ROLE` environment variable to `goap-farming`:

```bash
# Single bot
BOT_ROLE=goap-farming bun run start

# Multiple bots (in manager)
BOT_ROLE=goap-farming bun run start
```

### Comparing GOAP vs Behavior Tree

Run two bots side-by-side to compare:

```bash
# Terminal 1: Behavior tree bot (default)
BOT_ROLE=farming bun run start

# Terminal 2: GOAP bot
BOT_ROLE=goap-farming bun run start
```

## Key Components

### Phase 1: Foundation

#### WorldState (`src/planning/WorldState.ts`)
- Stores facts about the world as key-value pairs
- Examples: `inv.seeds: 15`, `has.hoe: true`, `nearby.matureCrops: 12`
- Immutable cloning for planning simulations

#### WorldStateBuilder (`src/planning/WorldStateBuilder.ts`)
- Converts Blackboard perception data to WorldState facts
- Categorizes facts: `inv.*`, `has.*`, `nearby.*`, `pos.*`, `state.*`, `derived.*`

#### Action Interface (`src/planning/Action.ts`)
- `GOAPAction` interface with preconditions, effects, cost, and execution
- `BaseGOAPAction` abstract class with helper methods
- Helper functions for creating preconditions and effects

### Phase 2: Planning Core

#### GOAPPlanner (`src/planning/GOAPPlanner.ts`)
- A* search algorithm to find optimal action sequences
- Configurable max iterations (default: 1000)
- Debug logging for planning decisions

#### Goals (`src/planning/Goal.ts`, `src/planning/goals/FarmingGoals.ts`)
- Goals return **utility scores** (0-100+) based on current state
- Higher utility = more desirable
- Example priorities:
  - `CollectDrops`: 100+ (items despawn!)
  - `HarvestCrops`: 60 + (crop_count * 3)
  - `DepositProduce`: 90 when inventory full
  - `Explore`: 5 (fallback, always available)

#### GoalArbiter (`src/planning/GoalArbiter.ts`)
- Selects best goal using utility scoring
- **Hysteresis** (20% threshold) prevents flip-flopping
- Only switches goals if new goal is significantly better

### Phase 3: HTN Layer

#### HTN Tasks (`src/planning/htn/HTNTask.ts`)
- **Primitive tasks**: Map directly to actions
- **Compound tasks**: Decompose into subtasks using methods
- **Methods**: Different ways to achieve the same task

#### HTN Decomposer (`src/planning/htn/HTNDecomposer.ts`)
- Recursively decomposes compound tasks
- Tries methods in order of cost (lowest first)
- Maximum recursion depth: 10

#### Example: ObtainHoeTask (`src/planning/htn/tasks/ObtainHoeTask.ts`)
- Method 1: Craft from existing materials (cost: 1.0)
- Method 2: Find in chest (cost: 2.0)
- Method 3: Gather wood then craft (cost: 5.0)

### Phase 4: Execution & Monitoring

#### PlanExecutor (`src/planning/PlanExecutor.ts`)
- Executes action sequences
- Monitors for failures (replan after 3 consecutive failures)
- Detects world state changes (replan if significant)
- Tracks statistics: actions executed, succeeded, failed, replans

#### Actions (`src/planning/actions/FarmingActions.ts`)
- Wrappers around existing behavior tree actions:
  - `PickupItemsAction` (cost: 0.5)
  - `HarvestCropsAction` (cost: 1.0)
  - `PlantSeedsAction` (cost: 1.5)
  - `TillGroundAction` (cost: 2.0)
  - `DepositItemsAction` (cost: 2.5)
  - `GatherSeedsAction` (cost: 3.0)
  - `GatherWoodAction` (cost: 5.0)
  - `CraftHoeAction` (cost: 2.0)
  - `ExploreAction` (cost: 10.0)

### Phase 7: Integration

#### GOAPRole (`src/roles/GOAPRole.ts`)
- Abstract base class for GOAP-based roles
- Main loop (100ms tick):
  1. **PERCEIVE**: Update blackboard
  2. **DECIDE**: Select goal and plan actions
  3. **ACT**: Execute plan
  4. **MONITOR**: Check for replan triggers

#### GOAPFarmingRole (`src/roles/GOAPFarmingRole.ts`)
- Concrete implementation for farming
- Initializes pathfinder, village chat
- Configurable debug mode

## Configuration

### GOAPRoleConfig

```typescript
{
  debug: true,              // Enable debug logging
  tickInterval: 100,        // Main loop interval (ms)
  maxPlanIterations: 1000   // Max A* iterations
}
```

### Enable Debug Mode

```typescript
// In bot.ts
'goap-farming': new GOAPFarmingRole({ debug: true })
```

Debug output shows:
- Goal selection with utility scores
- Plan generation with action sequences
- Execution progress
- Replan triggers

## How Goals Work

Goals are selected dynamically based on **utility**, not fixed priority:

```typescript
class CollectDropsGoal extends BaseGoal {
  getUtility(ws: WorldState): number {
    const dropCount = ws.getNumber('nearby.drops');
    if (dropCount === 0) return 0;

    // Very high urgency - items despawn!
    return Math.min(150, 100 + dropCount * 10);
  }
}
```

### Hysteresis Example

```
Current goal: HarvestCrops (utility: 70)
New goal:     PlantSeeds   (utility: 75)

Switch? No! (75 < 70 * 1.2 = 84)
-> Stick with HarvestCrops to avoid thrashing
```

## How Planning Works

1. **Goal Selection**: Arbiter picks highest utility goal
2. **A* Search**: Planner searches for action sequence
   - Start state: Current world state
   - Goal state: Goal conditions satisfied
   - Cost: Sum of action costs
3. **Execution**: Executor runs actions one by one
4. **Monitoring**: Watch for failures or world changes
5. **Replan**: If needed, go back to step 1

### Planning Example

```
Goal: ObtainTools (utility: 80)
Conditions: has.hoe = true

Current state: has.hoe=false, inv.logs=0, inv.planks=0

Plan:
  1. GatherWood (cost: 5.0)  → inv.logs = 4
  2. CraftHoe   (cost: 2.0)  → has.hoe = true

Total cost: 7.0
```

## Advantages Over Behavior Trees

| Feature | Behavior Tree | GOAP |
|---------|--------------|------|
| **Priorities** | Static, hardcoded | Dynamic, utility-based |
| **Adaptation** | Fixed sequence | Replans on failures |
| **Goal Selection** | First match wins | Best utility wins |
| **Action Sequences** | Predefined | Computed with A* |
| **World Changes** | May get stuck | Automatically replans |
| **Multi-step Tasks** | Manual composition | HTN decomposition |

## Future Enhancements (Phase 5-6)

The architecture supports these planned features:

### Phase 5: Multi-Agent Coordination
- Plan announcement via village chat
- Resource claiming (prevent competition)
- Conflict detection and resolution
- Coordinated task allocation

### Phase 6: Learning & Memory
- Action success/failure tracking
- Persistent knowledge across sessions
- Adaptive cost/utility tuning
- Experience-based planning

## Debugging

### Check Current Goal

```typescript
bot.on('chat', (username, message) => {
  if (message === 'status') {
    const role = currentRole as GOAPFarmingRole;
    bot.chat(role.getStatus());
    // Output: "Goal: HarvestCrops | executing: HarvestCrops (2/5) | 40%"
  }
});
```

### View Goal Utilities

```typescript
console.log(role.getGoalReport());
// Output:
// Goal Utilities:
//   CollectDrops: 120.0 ← CURRENT
//   HarvestCrops: 72.0
//   DepositProduce: 40.0
//   PlantSeeds: 0.0 [ZERO]
//   ...
```

### Execution Stats

```typescript
const stats = role.getStats();
console.log(`Actions: ${stats.actionsExecuted}, Succeeded: ${stats.actionsSucceeded}, Failed: ${stats.actionsFailed}, Replans: ${stats.replansRequested}`);
```

## Performance Considerations

- **Planning cost**: O(actions * iterations) - typically < 100ms
- **Memory**: ~1KB per WorldState, cloned during planning
- **CPU**: Main loop runs every 100ms (10 Hz)
- **Replanning**: Only when needed (failures, world changes)

## Adding New Goals

```typescript
export class MyNewGoal extends BaseGoal {
  name = 'MyNewGoal';
  description = 'Do something cool';

  conditions = [
    numericGoalCondition('my.fact', v => v > 10, 'fact is high'),
  ];

  getUtility(ws: WorldState): number {
    const value = ws.getNumber('my.fact');
    if (value < 5) return 0;
    return 50 + value * 2; // Utility scales with value
  }
}

// Add to createFarmingGoals() in FarmingGoals.ts
```

## Adding New Actions

```typescript
export class MyNewAction extends BaseGOAPAction {
  name = 'MyNewAction';

  preconditions = [
    booleanPrecondition('has.tool', true, 'has required tool'),
  ];

  effects = [
    incrementEffect('my.fact', 5, 'increased fact'),
  ];

  override getCost(ws: WorldState): number {
    return 3.0; // Lower = higher priority in planning
  }

  override async execute(bot, bb, ws): Promise<ActionResult> {
    // Your implementation here
    return ActionResult.SUCCESS;
  }
}

// Add to createFarmingActions() in FarmingActions.ts
```

## Known Limitations

1. **HTN decomposition** is currently example-only (ObtainHoeTask)
   - Most planning uses direct GOAP actions
   - HTN layer ready for complex multi-step tasks

2. **Multi-agent coordination** not yet implemented
   - Foundation exists in VillageChat
   - Phase 5 will add plan coordination

3. **Learning/memory** not yet implemented
   - Actions have static costs
   - Phase 6 will add adaptive tuning

## Troubleshooting

### Bot gets stuck / doesn't move
- Check debug logs for planning failures
- Verify goal utilities are non-zero
- Check action preconditions are satisfiable

### Bot switches goals too frequently
- Increase hysteresis threshold in GoalArbiter (default: 0.2)
- Adjust utility functions to be more stable

### Planning takes too long
- Reduce maxPlanIterations (default: 1000)
- Simplify action preconditions/effects
- Add more specific goals to reduce search space

### Actions keep failing
- Check PlanExecutor stats for failure patterns
- Verify action implementations handle edge cases
- Consider adding retry logic or alternative actions

## Testing

```bash
# Run type check
bunx tsc --noEmit

# Start bot with debug logging
BOT_ROLE=goap-farming bun run start

# Watch for planning decisions in console
# Look for:
# [GOAP] Goal: HarvestCrops (utility: 72.0, reason: switch)
# [Planner] Success! Found plan for HarvestCrops: PickupItems → HarvestCrops → PlantSeeds
# [PlanExecutor] Starting action 1/3: PickupItems
```

## References

- **GOAP**: Goal-Oriented Action Planning (Jeff Orkin, 2004)
- **HTN**: Hierarchical Task Network Planning (Erol et al., 1994)
- **A* Search**: Hart, Nilsson, Raphael (1968)
