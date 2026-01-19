# GOAP Planning System

This document explains the Goal-Oriented Action Planning (GOAP) system and why it's designed the way it is.

## What is GOAP?

GOAP is an AI planning technique where:
1. **Goals** define desired world states
2. **Actions** transform world states
3. **A planner** finds action sequences that achieve goals

Unlike behavior trees (which are authored decision trees), GOAP **generates** plans at runtime based on the current situation.

## The Planning Loop

Every 100ms, the GOAP role executes:

```
PERCEIVE → DECIDE → ACT → MONITOR
```

### Phase 1: PERCEIVE

```typescript
await this.updateBlackboard();
this.currentWorldState = WorldStateBuilder.fromBlackboard(this.bot, this.blackboard);
```

**Why separate steps?**

- `updateBlackboard()`: Expensive sensor operations (findBlocks, entity iteration)
- `WorldStateBuilder`: Cheap fact extraction

By separating them, we can potentially optimize sensing (cache, throttle) without affecting planning.

### Phase 2: DECIDE

```typescript
if (!this.executor.isExecuting()) {
    await this.planNextGoal();
}
```

**Why only plan when not executing?**

Planning is expensive. Re-planning every tick would:
1. Waste CPU
2. Cause "plan churn" - constantly switching strategies

Instead, we commit to a plan and only re-plan when:
- Plan completes
- Plan fails
- World changes significantly

### Phase 3: ACT

```typescript
await this.executor.tick(this.currentWorldState);
```

**Why pass WorldState to executor?**

Actions may need current facts to make decisions. For example, `CraftHoe` checks if it should make sticks first based on current inventory.

### Phase 4: MONITOR

```typescript
this.executor.checkWorldStateChange(this.currentWorldState);
```

**Why monitor for world changes?**

Plans can become invalid:
- Goal was to collect drops, but another bot collected them
- Goal was to harvest, but crops were trampled

The monitor calculates `diff(initialState, currentState)`. If significant changes detected → trigger replan.

## The Goal System

### Anatomy of a Goal

```typescript
class CollectDropsGoal extends BaseGoal {
    name = 'CollectDrops';

    conditions = [
        numericGoalCondition('nearby.drops', v => v === 0, 'no drops nearby'),
    ];

    getUtility(ws: WorldState): number {
        const dropCount = ws.getNumber('nearby.drops');
        return Math.min(150, 100 + dropCount * 10);
    }
}
```

### Conditions: When is the Goal Satisfied?

The `conditions` array defines what the world must look like for the goal to be "done":

```typescript
numericGoalCondition('nearby.drops', v => v === 0, 'no drops nearby')
```

This says: "The goal is satisfied when there are zero nearby drops."

**Why a function check instead of just a value?**

Flexibility. Conditions can express:
- `v === 0` (zero)
- `v >= 10` (at least 10)
- `v < 5` (fewer than 5)

### Utility: How Important is This Goal?

`getUtility()` returns a number representing current importance:

```typescript
return Math.min(150, 100 + dropCount * 10);
```

**Why not fixed priorities?**

Priorities must respond to context:
- 1 drop nearby: utility = 110
- 5 drops nearby: utility = 150
- 0 drops nearby: utility = 0 (goal not relevant)

The arbiter picks the highest-utility goal. This creates dynamic priorities.

### isValid: Can This Goal Be Pursued?

Optional method to disable goals in certain states:

```typescript
isValid(ws: WorldState): boolean {
    return !ws.getBool('state.inventoryFull');
}
```

**Why separate from utility?**

- `utility = 0` means "not important right now"
- `isValid = false` means "impossible/nonsensical to attempt"

Example: Can't harvest if inventory is full. Setting utility to 0 works, but `isValid` makes the intent clearer.

## The Action System

### Anatomy of an Action

```typescript
class HarvestCropsAction extends BaseGOAPAction {
    name = 'HarvestCrops';

    preconditions = [
        numericPrecondition('nearby.matureCrops', v => v > 0, 'mature crops available'),
        booleanPrecondition('state.inventoryFull', false, 'inventory not full'),
    ];

    effects = [
        incrementEffect('inv.produce', 10, 'harvested produce'),
        setEffect('nearby.matureCrops', 0, 'crops harvested'),
    ];

    getCost(ws: WorldState): number {
        return 1.0;
    }

    async execute(bot, bb, ws): Promise<ActionResult> {
        // Actually harvest crops
    }
}
```

### Preconditions: When Can This Action Run?

```typescript
numericPrecondition('nearby.matureCrops', v => v > 0, 'mature crops available')
```

The planner only considers actions whose preconditions are satisfied.

**Why preconditions matter for planning:**

The planner searches backward from the goal:
1. Goal needs `nearby.matureCrops == 0`
2. HarvestCrops achieves that
3. But HarvestCrops requires `nearby.matureCrops > 0`
4. Current state has crops? Plan: [HarvestCrops]
5. No crops? HarvestCrops not applicable, try different actions

### Effects: What Does This Action Change?

```typescript
incrementEffect('inv.produce', 10, 'harvested produce')
```

Effects predict how the world changes after the action succeeds.

**Why "predicted" effects?**

The planner simulates executing actions:
```
State0 + HarvestCrops.effects → State1
State1 + PlantSeeds.effects → State2
...
```

This lets A* search find action sequences without actually executing anything.

**Why effects don't match reality perfectly:**

```typescript
incrementEffect('inv.produce', 10, ...)  // Claims +10 produce
```

In reality, harvest might yield 8 or 12. That's okay - effects are estimates for planning. The actual execution handles reality.

### getCost: How Expensive is This Action?

```typescript
getCost(ws: WorldState): number {
    return 1.0;
}
```

Lower cost = A* prefers this action.

**Why dynamic cost?**

```typescript
getCost(ws: WorldState): number {
    const grassCount = ws.getNumber('nearby.grass');
    return grassCount > 0 ? 2.0 : 4.0;  // Cheaper if grass is visible
}
```

Cost can reflect:
- Distance to target
- Likelihood of success
- Resource requirements

## The A* Planner

### Search Space

The planner searches through a graph where:
- **Nodes** are WorldState snapshots
- **Edges** are actions

```
[Initial State] --HarvestCrops--> [State with less crops]
                --PlantSeeds--> [State with less farmland]
                --Explore--> [State with reset idle]
```

### Why A* Instead of Simpler Algorithms?

**Breadth-first**: Finds shortest plan but ignores cost. Would pick `[Explore, Explore, Explore]` over `[HarvestCrops]`.

**Depth-first**: Fast but might miss better solutions or get stuck in long branches.

**A***: Uses heuristic to find **optimal** (lowest cost) plans efficiently.

### The Heuristic Function

```typescript
private heuristic(state: WorldState, goal: Goal): number {
    for (const condition of goal.conditions) {
        if (!condition.check(state.get(condition.key))) {
            // Estimate remaining work
            if (condition.numericTarget) {
                const distance = target.value - currentValue;
                const estimatedActions = distance / delta;
                totalCost += estimatedActions * 3;
            } else {
                totalCost += 5;  // Unknown condition, guess
            }
        }
    }
    return totalCost;
}
```

**Why this specific heuristic?**

A* needs an **admissible** heuristic (never overestimates true cost).

For numeric goals like `inv.logs >= 64`:
- Current logs: 4
- Target: 64
- Estimated logs per ChopTree: 4
- Heuristic: (64-4)/4 * avgCost = 15 * 3 = 45

This guides A* toward efficient plans.

### State Deduplication

```typescript
const stateKey = this.getStateKey(state);
if (closedSet.has(stateKey)) continue;
```

**Why deduplicate states?**

Without this, A* would revisit the same state through different paths:
```
Path 1: PickupItems → HarvestCrops → [State X]
Path 2: HarvestCrops → PickupItems → [State X]
```

Both reach the same state. Only expand once.

**Why not hash the entire state?**

```typescript
const importantFacts = [
    'has.hoe', 'inv.seeds', 'nearby.matureCrops', ...
];
```

Full state hashing would differentiate states that differ only in irrelevant facts. We only hash facts that actions can affect.

### Critical: Incremental Effects Need State Keys

**Bug pattern to avoid**: If an action uses `incrementEffect` (e.g., `incrementEffect('pending.signWrites', -1)`), that fact MUST be in `importantFacts`.

Why? Consider a goal requiring `pending.signWrites == 0` starting from `pending.signWrites == 2`:
1. Planner applies `WriteKnowledgeSign` → state becomes `pending.signWrites = 1`
2. State added to closed set with key that doesn't include `pending.signWrites`
3. Planner tries `WriteKnowledgeSign` again to reach `pending.signWrites = 0`
4. But the resulting state has the **same key** (since `pending.signWrites` isn't in the key)
5. Planner says "state in closed set" and skips it
6. Plan fails - can never find `[WriteKnowledgeSign, WriteKnowledgeSign]` sequence

**Rule**: Any fact modified by `incrementEffect` or that requires multiple action applications must be in the state key.

## The Plan Executor

### Execution Flow

```typescript
async tick(currentState: WorldState): Promise<boolean> {
    if (this.currentAction === null) {
        this.currentAction = this.currentPlan[this.currentActionIndex];
    }

    const result = await this.currentAction.execute(bot, bb, ws);

    if (result === SUCCESS) {
        this.currentActionIndex++;
        this.currentAction = null;
    } else if (result === FAILURE) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3) {
            this.requestReplan(REASON.ACTION_FAILED);
        }
    }
    // RUNNING = continue next tick
}
```

### Why Allow "RUNNING" Result?

Some actions take multiple ticks:
- Pathfinding to a distant block
- Waiting for crafting table animation
- Breaking multiple blocks

`RUNNING` means "I'm working on it, call me again next tick."

### Why Consecutive Failure Threshold?

```typescript
if (this.consecutiveFailures >= 3) {
    this.requestReplan();
}
```

Single failures happen:
- Pathfinding blocked temporarily
- Entity moved during targeting
- Timing issues

Retrying often succeeds. But 3 consecutive failures suggest a systematic problem → replan.

### Why Track `hadRecentFailures()`?

When a plan is exhausted (all actions processed), we need to know WHY:

1. **All succeeded**: Goal achieved! No cooldown needed.
2. **Some failed**: Goal might not be achievable. Apply cooldown.

```typescript
if (reason === PLAN_EXHAUSTED && hadFailures) {
    this.failedGoalCooldowns.set(goal.name, now + 5000);
}
```

## The Goal Arbiter

### Selection Algorithm

```typescript
selectGoal(ws: WorldState, skipGoals?: Set<string>): GoalSelectionResult | null {
    const scoredGoals = [];

    for (const goal of this.goals) {
        if (skipGoals?.has(goal.name)) continue;
        if (goal.isValid && !goal.isValid(ws)) continue;

        const utility = goal.getUtility(ws);
        if (utility <= 0) continue;

        scoredGoals.push({ goal, utility });
    }

    scoredGoals.sort((a, b) => b.utility - a.utility);
    return applyHysteresis(scoredGoals[0]);
}
```

### Why Filter Invalid Goals?

Goals that can't succeed shouldn't compete:
- `HarvestCrops` when inventory full
- `PlantSeeds` without a hoe

Filtering them prevents wasted planning attempts.

### Why Skip Goals on Cooldown?

```typescript
if (skipGoals?.has(goal.name)) continue;
```

Cooldowns are applied after failures. Skipping prevents immediate retry of failing goals.

### Why Hysteresis?

```typescript
if (bestUtility < currentUtility * 1.2) {
    return { goal: currentGoal, reason: 'hysteresis' };
}
```

Prevents thrashing when goals have similar utilities:
- Frame 1: Harvest=50, Plant=51 → Plant
- Frame 2: Harvest=51, Plant=50 → Harvest
- Frame 3: ... infinite switching

With 20% hysteresis, a new goal must be 20% better to trigger a switch.

### Goal Preemption: Interrupting Running Actions

When an action returns `RUNNING`, it holds the executor in a waiting state. Without preemption, long-running actions (like `CheckSharedChest` waiting for materials) would block all goal re-evaluation—even for urgent goals like `RespondToTradeOffer`.

**The preemption mechanism:**

```typescript
// In GOAPRole.tick()
if (this.executor.isExecuting()) {
    await this.checkGoalPreemption();
}
```

Every tick while executing, we check if a significantly better goal should interrupt:

```typescript
// Preemption requires utility > currentUtility + 30
if (bestUtility > currentUtility + PREEMPTION_UTILITY_THRESHOLD) {
    this.executor.cancel();
    this.arbiter.clearCurrentGoal();
    await this.planNextGoal();  // Switch to new goal
}
```

**Why a higher threshold than hysteresis?**

Interrupting a running action has costs:
- Partial progress is lost
- Resources may be in inconsistent state
- Multiple interruptions cause thrashing

The preemption threshold (30 utility points) is higher than normal hysteresis (20%) to ensure only truly urgent goals interrupt.

**Example scenario:**

| Goal | Utility | Action State |
|------|---------|--------------|
| ObtainTools | 80 | `CheckSharedChest` returning RUNNING |
| RespondToTradeOffer | 120 | Not started |

Since 120 > 80 + 30, `RespondToTradeOffer` preempts `CheckSharedChest`. The farmer stops waiting for materials and immediately responds to the trade offer.

## Debugging Tips

### Enable Debug Logging

```typescript
new GOAPPlanner(actions, { debug: true });
new GoalArbiter(goals, { debug: true });
new PlanExecutor(bot, bb, onReplan, { debug: true });
```

### Goal Report

```typescript
const report = arbiter.getGoalReport(worldState);
console.log(report);
// Output:
// Goal Utilities:
//   CollectDrops: 0 [ZERO]
//   HarvestCrops: 75.0 ← CURRENT
//   DepositProduce: 20.0
//   PlantSeeds: 45.0
```

### Plan Visualization

```typescript
console.log(`Plan: ${plan.map(a => a.name).join(' → ')}`);
// Output: Plan: CheckSharedChest → CraftHoe → TillGround → PlantSeeds
```

### Execution Stats

```typescript
const stats = executor.getStats();
// { actionsExecuted: 45, actionsSucceeded: 42, actionsFailed: 3, replansRequested: 2 }
```

## Common Patterns

### Goal That's Always Applicable

```typescript
class ExploreGoal extends BaseGoal {
    // No conditions (always "unsatisfied")
    conditions = [];

    getUtility(ws: WorldState): number {
        // Low base utility, higher when idle
        return 5 + Math.min(25, ws.getNumber('state.consecutiveIdleTicks') / 2);
    }

    isValid(): boolean {
        return true;  // Always valid
    }
}
```

This creates a fallback goal that activates when nothing else to do.

### Action With Dynamic Preconditions

```typescript
class CraftHoeAction extends BaseGOAPAction {
    // Static preconditions can't express OR logic
    preconditions = [];

    // Override for custom logic
    override checkPreconditions(ws: WorldState): boolean {
        const logs = ws.getNumber('inv.logs');
        const planks = ws.getNumber('inv.planks');
        const sticks = ws.getNumber('inv.sticks');

        // Can craft if: logs >= 2 OR planks >= 4 OR (planks >= 2 AND sticks >= 2)
        return logs >= 2 || planks >= 4 || (planks >= 2 && sticks >= 2);
    }
}
```

### Multi-Step Action

```typescript
async execute(bot, bb, ws): Promise<ActionResult> {
    if (!this.hasPlanksCrafted) {
        await craftPlanks();
        return ActionResult.RUNNING;  // Not done yet
    }

    if (!this.hasSticksCrafted) {
        await craftSticks();
        return ActionResult.RUNNING;  // Still not done
    }

    await craftHoe();
    return ActionResult.SUCCESS;  // Now we're done
}
```

Each call advances one step. RUNNING signals "more work needed."

### Action Chaining with Custom Preconditions

When an action has complex material requirements, use `checkPreconditions` to enable planner chaining:

```typescript
class WriteKnowledgeSignAction extends BaseGOAPAction {
    // Sign needs 6 planks + 1 stick, OR already have a sign
    override checkPreconditions(ws: WorldState): boolean {
        // Already have a sign - can write immediately
        if (ws.getBool('has.sign')) return true;

        // Can craft (derived fact checks crafting table too)
        if (ws.getBool('derived.canCraftSign')) return true;

        // Raw material check - allows ProcessWood to chain
        const planks = ws.getNumber('inv.planks');
        const sticks = ws.getNumber('inv.sticks');
        return planks >= 6 && sticks >= 1;
    }

    effects = [
        incrementEffect('inv.planks', -6, 'used planks for sign'),
        incrementEffect('inv.sticks', -1, 'used stick for sign'),
    ];
}
```

**Why this works for chaining**: When the bot needs to write a FARM sign but has no materials:

For farmers, `GetSignMaterialsAction` enables the chain:
1. Check `GetSignMaterials` preconditions → `pending.signWrites > 0` and no sign materials
2. Apply `GetSignMaterials` → state has `inv.planks = 6, inv.sticks = 2, canCraftSign = true`
3. Check `WriteKnowledgeSign` preconditions → passes (can craft)
4. Plan: `[GetSignMaterials, WriteKnowledgeSign]`

For lumberjacks, `ProcessWood` enables the chain:
1. Apply `ProcessWood` → state has `inv.planks = 8`
2. Check `WriteKnowledgeSign` preconditions → `8 >= 6` passes
3. Plan: `[ProcessWood, WriteKnowledgeSign]`

**FARM Sign Priority**: FARM signs have utility 200-250 (highest non-trade priority) because:
- Landscapers cannot terraform without knowing farm locations
- A farmer death without a FARM sign loses the farm location permanently
- The sign should be written BEFORE gathering seeds, crafting hoe, or any farming work
