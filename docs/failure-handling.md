# Failure Handling & Stability

This document explains how the bot system handles failures at every level and why these mechanisms exist.

## Failure Categories

The bot faces failures at multiple levels:

```
┌──────────────────────────────────────────────────────────┐
│                    Process Level                          │
│  Bot crashes, server disconnects, file system errors     │
├──────────────────────────────────────────────────────────┤
│                    Planning Level                         │
│  No valid plan, goal unsatisfied, action preconditions   │
├──────────────────────────────────────────────────────────┤
│                    Execution Level                        │
│  Pathfinding fails, block breaks, entity moves           │
├──────────────────────────────────────────────────────────┤
│                    World Level                            │
│  Another player interferes, server lag, chunk unloading  │
└──────────────────────────────────────────────────────────┘
```

Each level has different failure modes and recovery strategies.

## Process-Level Recovery

### Crash Detection

The process manager monitors bot subprocess exit:

```typescript
currentProcess.exited.then((exitCode: number) => {
    if (exitCode !== 0 && exitCode !== null) {
        // Non-zero exit = crash
        scheduleRestart(config);
    }
});
```

**Why check exit code?**

- Exit 0: Intentional shutdown (Ctrl+C), no restart needed
- Exit non-zero: Crash, exception, should restart

### Exponential Backoff

```typescript
const attempts = reconnectAttempts.get(configKey) || 0;
const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, attempts), MAX_BACKOFF);
// 1s → 2s → 4s → 8s → 16s → 30s (max)

reconnectAttempts.set(configKey, attempts + 1);
setTimeout(() => startBot(config), delay);
```

**Why exponential?**

| Failure Type | Pattern | Desired Response |
|--------------|---------|------------------|
| Transient | Single crash | Fast restart (1s) |
| Repeated | Crash loop | Slow down (backoff) |
| Persistent | Server down | Don't spam (cap at 30s) |

Exponential backoff naturally handles all three.

**Why 30 second cap?**

Beyond 30s, waiting longer doesn't help. If server is down for 10 minutes, 30s retries will reconnect soon after it's back.

### Backoff Reset

```typescript
if (text.includes("✅ Bot has spawned!")) {
    reconnectAttempts.set(configKey, 0);  // Reset on success
}
```

**Why reset?**

After successful spawn:
- Previous failures were transient
- Next failure should get fast restart again

Without reset, a bot that crashed once would forever have slow restarts.

### Zombie Detection

```typescript
private isBotConnected(): boolean {
    const client = (this.bot as any)._client;
    if (!client || !client.socket || client.socket.destroyed) {
        return false;
    }
    if (!this.bot.entity) return false;
    return true;
}
```

**What's a zombie?**

Mineflayer can enter a state where:
- Bot object exists
- Event handlers fire
- But network socket is dead

The tick loop runs, consuming CPU, but the bot can't actually interact with the world.

**Why check socket.destroyed?**

This is the definitive test. A destroyed socket cannot send or receive data.

**Why check bot.entity?**

Entity exists only after spawning. If bot object exists but entity doesn't:
- Bot was kicked
- Server restarted
- Connection lost during spawn

### Graceful Stop on Zombie

```typescript
if (!this.isBotConnected()) {
    console.error(`[GOAP] Connection lost - stopping ${this.name}`);
    this.stop(this.bot);
    return;
}
```

**Why stop instead of crash?**

Stopping cleanly allows:
- Cleanup code to run
- Process to exit with code 0
- Manager to restart fresh

Crashing might leave resources locked.

## Planning-Level Recovery

### No Valid Plan

```typescript
const planResult = this.planner.plan(this.currentWorldState, goal);

if (!planResult.success) {
    console.log(`[GOAP] Failed to plan for goal: ${goal.name}`);
    this.failedGoalCooldowns.set(goal.name, now + 5000);
    this.arbiter.clearCurrentGoal();
    return;
}
```

**Why planning can fail:**

1. **Preconditions unachievable**: Need hoe but no wood and no chest
2. **Max iterations**: Complex plan space exhausted budget
3. **Deadlock**: Circular dependencies

**Why cooldown on failure?**

Without cooldown:
1. Plan fails for "ObtainTools"
2. Next tick: "ObtainTools" still highest utility
3. Plan fails again
4. Infinite loop

5 second cooldown lets other goals try, world potentially change.

**Why clear current goal?**

Arbiter uses hysteresis. If we don't clear, arbiter might "stick" to the failed goal even after cooldown expires.

### No Valid Goals

```typescript
const goalResult = this.arbiter.selectGoal(ws, goalsOnCooldown);

if (!goalResult) {
    if (this.config.debug) {
        console.log('[GOAP] No valid goals, idling');
    }
    return;
}
```

**When this happens:**

- All goals have utility ≤ 0
- All goals are on cooldown
- All goals are invalid for current state

**Why idle instead of crash?**

Idling is a valid state. The bot might be:
- Waiting for crops to grow
- Waiting for lumberjack to deposit
- Waiting for world to change

Next tick might have valid goals.

### Goal Cooldown Management

```typescript
// Clean up expired cooldowns
const now = Date.now();
for (const [goalName, expiry] of this.failedGoalCooldowns) {
    if (now >= expiry) {
        this.failedGoalCooldowns.delete(goalName);
    }
}
```

**Why cleanup instead of check-on-read?**

With cleanup:
- `skipGoals` set stays small
- No stale entries accumulating
- Clear debug output

## Execution-Level Recovery

### Action Failure Counting

```typescript
private handleActionFailure(): void {
    this.stats.actionsFailed++;
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.config.maxFailures) {
        this.requestReplan(ReplanReason.ACTION_FAILED);
        return;
    }

    // Move to next action
    this.currentAction = null;
    this.currentActionIndex++;
}
```

**Why count consecutive failures?**

Single failures are normal:
- Mob blocked path temporarily
- Server lag caused timing issue
- Chunk loaded slowly

Consecutive failures suggest systematic problem:
- Resource doesn't exist
- Path permanently blocked
- State mismatch

**Why threshold of 3?**

Empirically tuned:
- 1: Too sensitive, normal variance triggers replan
- 5: Too tolerant, wasted time on hopeless plans
- 3: Good balance

### Action Cancellation

```typescript
if (this.currentAction && this.currentAction.cancel) {
    this.currentAction.cancel();
}
```

**Why cancel?**

Some actions have ongoing state:
- Pathfinding in progress
- Crafting window open
- Chest transaction pending

Cancelling releases resources and prevents state corruption.

### hadRecentFailures Distinction

```typescript
hadRecentFailures(): boolean {
    return this.consecutiveFailures > 0;
}

// Used in replan handling
if (reason === ReplanReason.PLAN_EXHAUSTED && hadFailures) {
    // Apply cooldown - plan failed
} else if (reason === ReplanReason.PLAN_EXHAUSTED && !hadFailures) {
    // No cooldown - plan succeeded
}
```

**Why track separately?**

Plan exhaustion has two meanings:

| Scenario | consecutiveFailures | Meaning | Action |
|----------|---------------------|---------|--------|
| All actions succeeded | 0 | Goal achieved | No cooldown |
| Some actions failed | > 0 | Goal problematic | Apply cooldown |

This distinction prevents punishing successful goals.

## World-Level Recovery

### World State Change Detection

```typescript
checkWorldStateChange(currentState: WorldState): void {
    const changes = currentState.diff(this.initialWorldState);

    if (changes >= CHANGE_THRESHOLD) {
        this.requestReplan(ReplanReason.WORLD_CHANGED);
    }
}
```

**What triggers this?**

- Player harvested crops bot was planning to harvest
- Another bot collected items
- Server moved entities
- Chunk unloaded and reloaded

**Why threshold instead of any change?**

Normal operation causes changes:
- `inv.produce` increases as bot harvests
- `nearby.drops` fluctuates

Only significant deviation (5+ fact changes) warrants replanning.

### Unreachable Item Tracking

```typescript
// In blackboard
unreachableDrops: Map<number, number>;  // entity ID → expiry timestamp

// When pathfinding fails
bb.unreachableDrops.set(entity.id, Date.now() + 30000);

// When checking drops
if (bb.unreachableDrops.has(entity.id)) {
    continue;  // Skip this drop
}
```

**Why track unreachable items?**

Without tracking:
1. Try to reach item on ledge
2. Pathfinding fails
3. Next tick: try same item
4. Infinite loop

With tracking, item is "blacklisted" for 30 seconds.

**Why expire after 30 seconds?**

- Item might fall to reachable location
- Bot might approach from different angle
- Obstacle might move

### Bad Water Memory

```typescript
// Water found in cave - useless for farming
bb.badWaterPositions.push({
    position: pos.clone(),
    timestamp: Date.now(),
    reason: 'cave_water'
});
```

**Why track bad water?**

Cave water can't grow crops (no light). Without memory:
1. Find water, check for clear sky
2. Fail (it's in a cave)
3. Search for water, find same water
4. Repeat forever

With memory, known bad water is excluded from searches.

### Exploration Scoring

```typescript
function getExplorationScore(bb: FarmingBlackboard, pos: Vec3): number {
    let score = 100;

    for (const explored of bb.exploredPositions) {
        const dist = explored.position.distanceTo(pos);
        if (dist < 32) {
            score -= (32 - dist) * 2;  // Closer = worse
        }
    }

    for (const badWater of bb.badWaterPositions) {
        const dist = badWater.position.distanceTo(pos);
        if (dist < 48) {
            score -= (48 - dist) * 3;  // Heavy penalty
        }
    }

    return score;
}
```

**Why score-based?**

Binary "visited/not visited" doesn't capture:
- How recently visited
- How close to other visited areas
- Areas to actively avoid

Scoring enables nuanced exploration decisions.

## Pathfinding Failure Handling

### Expected Errors

```typescript
// In role setup
this.bot.on('error', (err: Error) => {
    const msg = err.message || '';

    // These are normal, not bugs
    if (msg.includes('goal was changed')) return;
    if (msg.includes('No path to the goal')) return;
    if (msg.includes('Path was stopped')) return;

    console.error('[Bot] Error:', err);
});
```

**Why suppress these?**

Mineflayer emits errors for non-error situations:
- `goal was changed`: Normal when action switches goals
- `No path`: Block might be unreachable, action will handle
- `Path was stopped`: Intentional cancellation

Logging them creates noise without actionable information.

### Pathfinding Timeout

```typescript
const result = await smartPathfinderGoto(
    bot,
    new GoalNear(pos.x, pos.y, pos.z, 2),
    { timeoutMs: 30000 }
);
```

**Why timeout?**

Without timeout, pathfinding might:
- Search forever in complex terrain
- Get stuck calculating impossible paths
- Block all other bot activity

30 seconds is long enough for reasonable paths, short enough to fail fast on impossible ones.

## Tick Guard

```typescript
this.tickInterval = setInterval(() => {
    if (this.ticking) return;  // Skip if previous tick running
    this.ticking = true;
    this.tick()
        .catch(err => console.error('[GOAP] Tick error:', err))
        .finally(() => this.ticking = false);
}, this.config.tickInterval);
```

### Why Guard Against Overlapping Ticks?

Ticks are async. Pathfinding might take 500ms. Without guard:

```
Tick 1 starts at 0ms
Tick 2 starts at 100ms (while tick 1 running!)
Tick 3 starts at 200ms (now 3 concurrent ticks!)
...
```

This causes:
- State corruption (concurrent mutations)
- Resource exhaustion (pathfinder overload)
- Unpredictable behavior

### Why Not Just Await Each Tick?

```typescript
// This would block the event loop
while (running) {
    await tick();
    await sleep(100);
}
```

Problems:
- Event handlers don't fire during tick
- Chat messages might be missed
- Bot appears frozen

The interval + guard pattern keeps event loop responsive.

## Error Propagation

### Don't Crash on Errors

```typescript
protected async tick(): Promise<void> {
    try {
        await this.updateBlackboard();
        // ... rest of tick
    } catch (error) {
        console.error('[GOAP] Error in tick:', error);
        // Don't re-throw - let next tick try again
    }
}
```

**Why catch instead of crash?**

Transient errors shouldn't kill the bot:
- Network hiccup during block read
- Entity despawned during iteration
- Server lag caused timeout

Log the error, try again next tick.

### Fail Fast on Critical Errors

```typescript
if (!this.isBotConnected()) {
    console.error(`[GOAP] Connection lost`);
    this.stop(this.bot);
    return;
}
```

Some errors indicate unrecoverable state. Connection loss can't be fixed by retrying ticks.

## Debugging Aids

### Stats Tracking

```typescript
interface ExecutionStats {
    actionsExecuted: number;
    actionsSucceeded: number;
    actionsFailed: number;
    replansRequested: number;
}
```

**Why track stats?**

Patterns reveal problems:
- High fail rate: Actions have wrong preconditions
- Many replans: World changing faster than bot adapts
- Low throughput: Bot spending time on wrong things

### Goal Reports

```typescript
getGoalReport(ws: WorldState): string {
    const lines: string[] = ['Goal Utilities:'];
    for (const goal of this.goals) {
        const utility = goal.getUtility(ws);
        lines.push(`  ${goal.name}: ${utility.toFixed(1)}`);
    }
    return lines.join('\n');
}
```

**Why report?**

When bot does unexpected things:
```
Goal Utilities:
  CollectDrops: 0 [ZERO]
  HarvestCrops: 0 [ZERO]
  Explore: 35.0 ← CURRENT
```

"Ah, bot is exploring because there's nothing to harvest. Need to check crop growth."

### Plan Logging

```typescript
if (this.config.debug) {
    console.log(
        `[GOAP] Plan: ${plan.map(a => a.name).join(' → ')} (cost: ${cost})`
    );
}
```

**Why log plans?**

Plans reveal reasoning:
```
Plan: CheckSharedChest → CraftHoe → TillGround
```

"Bot is going to chest first because it doesn't have materials for hoe."

## Summary: Failure Recovery Strategies

| Level | Detection | Recovery |
|-------|-----------|----------|
| Process | Exit code | Exponential backoff restart |
| Connection | Socket state | Stop and restart |
| Planning | Plan fails | Goal cooldown |
| Execution | Action returns FAILURE | Retry, then replan |
| World | State diff | Replan |
| Pathfinding | Timeout | Mark unreachable |

The system assumes failures are **normal** and designs for graceful degradation rather than crash-free operation.
