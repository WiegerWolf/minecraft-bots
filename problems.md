# Problems Identified from Log Analysis

This file contains bugs and issues identified from log monitoring sessions. Each problem includes observed symptoms, potential root causes, and severity.

---

## HIGH SEVERITY

### 1. FollowLumberjack Goal Consistently Fails to Plan

**Observed:** 43 instances of "Failed to plan for goal FollowLumberjack" in latest session.

**Symptoms:**
- Goal is selected with utility 55-70 (when farmer is far from lumberjack)
- Planner immediately fails to find a plan
- Farmer falls back to GatherSeeds, then retries FollowLumberjack again
- Creates a loop: FollowLumberjack → fail → GatherSeeds → FollowLumberjack → fail...

**Log Pattern:**
```
23:16:39 GOAP: Goal selected FollowLumberjack
23:16:40 GOAP: Failed to plan for goal FollowLumberjack
23:16:41 GOAP: Goal selected GatherSeeds
...
23:16:46 GOAP: Goal selected FollowLumberjack
23:16:47 GOAP: Failed to plan for goal FollowLumberjack
```

**Analysis:**
- Goal condition: `nearby.lumberjackDistance <= 30`
- Action effect: `setEffect('nearby.lumberjackDistance', 20)`
- Action preconditions require: `nearby.hasLumberjack: true`, `nearby.lumberjackDistance > 30`

**Potential Causes:**
1. `nearby.hasLumberjack` might be FALSE in the WorldState despite goal utility being non-zero
2. State key deduplication issue - `nearby.lumberjackDistance` is NOT in `importantFacts`
3. The lumberjack may move out of range between goal selection and planning

**Impact:** Farmer wastes time repeatedly trying to follow lumberjack instead of productive work.

**Location:** `src/planning/goals/FarmingGoals.ts:370-419`, `src/planning/actions/FarmingActions.ts:342-370`

---

### 2. FulfillNeeds Goal Consistently Fails to Plan

**Observed:** 43 instances of "Failed to plan for goal FulfillNeeds" in latest session.

**Symptoms:**
- Goal selected with utility 120 (indicating `can.spareForNeeds` is TRUE)
- Planner immediately fails to find a valid plan
- Lumberjack cycles between FulfillNeeds → fail → other goals → FulfillNeeds

**Log Pattern:**
```
23:16:53 Failed to find plan FulfillNeeds
23:16:53 Failed to plan for goal FulfillNeeds
...
23:17:06 Failed to find plan FulfillNeeds
23:17:06 Failed to plan for goal FulfillNeeds
```

**Analysis:**
- Goal utility returns 120 when `hasNeeds && canSpare`
- Action (RespondToNeedAction) has matching preconditions
- Both check the same `can.spareForNeeds` boolean

**Potential Causes:**
1. Race condition: `canSpare` true during goal selection, false during planning
2. The action's effects don't match what the goal conditions expect
3. Missing action in the action list that can satisfy the goal

**Impact:** Other bots waiting for materials never receive them; lumberjack stuck in failure loop.

**Location:** `src/planning/goals/LumberjackGoals.ts:36-58`, `src/planning/actions/LumberjackActions.ts:202-227`

---

### 3. ObtainTools Goal Fails to Plan (Farmer)

**Observed:** 400+ instances in session `2026-01-19_21-48-48`, 26 in session `2026-01-19_22-54-38`.

**Symptoms:**
- Farmer has no hoe and no materials
- ObtainTools goal selected but planner can't find a path to get materials
- Farmer stuck unable to start farming

**Analysis:**
- Goal requires `has.hoe: true`
- Actions available: CraftHoe (needs materials), CheckSharedChest (needs chest), BroadcastNeed
- If no chest and no materials, planner has no valid path

**Potential Causes:**
1. No shared chest established yet
2. Chest is empty
3. Farmer spawns before lumberjack deposits materials
4. Missing action chaining (no way to get materials without existing infrastructure)

**Impact:** Farmer completely blocked from productive work.

**Location:** `src/planning/goals/FarmingGoals.ts:135-167`, `src/planning/actions/FarmingActions.ts`

---

### 4. FulfillTerraformRequest Goal Fails to Plan (Landscaper)

**Observed:** 400 instances in session `2026-01-19_21-48-48`.

**Symptoms:**
- Landscaper has pending terraform requests
- Goal selected but planner immediately fails
- Requests never fulfilled

**Potential Causes:**
1. Missing tools (shovel/pickaxe) and no way to obtain them
2. Terraform location unreachable
3. Action preconditions not satisfiable

**Impact:** Terraform requests never completed; farmer's field never flattened.

**Location:** `src/planning/goals/LandscaperGoals.ts` (if exists), landscaper actions

---

### 5. PickupItems Action Failures (Unreachable Items)

**Observed:** 21 action failures for PickupItems in latest session.

**Symptoms:**
- CollectDrops goal selected successfully, plan created with PickupItems action
- Action fails with "Pickup path failed: unreachable" or "Pickup path failed: timeout"
- After failure, goal is re-selected and fails again

**Log Pattern:**
```
23:16:39 [Lumberjack] Pickup path failed: unreachable
23:16:39 Action failed PickupItems
```

**Analysis:**
- Items may be in water, on ledges, or in caves
- Pathfinder timeout is 30 seconds
- Unreachable items are supposed to be tracked in `bb.unreachableDrops`

**Potential Causes:**
1. Items not being added to `unreachableDrops` after failure
2. `unreachableDrops` expiry too short (30 seconds)
3. Items falling into inaccessible locations (water, ravines)

**Impact:** Bot wastes time repeatedly trying to reach impossible items.

**Location:** `src/roles/farming/behaviors/actions/PickupItems.ts`

---

## MEDIUM SEVERITY

### 6. CraftAxe Action Failures

**Observed:** 6 action failures for CraftAxe in latest session.

**Symptoms:**
- ObtainAxe goal selected
- CraftAxe action fails during execution

**Potential Causes:**
1. Crafting table not accessible or destroyed
2. Missing materials (logs processed into planks before action runs)
3. Inventory race condition

**Location:** `src/roles/lumberjack/behaviors/actions/CraftAxe.ts`

---

### 7. BroadcastTradeOffer Action Failures

**Observed:** 4 action failures for BroadcastTradeOffer in latest session.

**Symptoms:**
- BroadcastTradeOffer goal selected
- Action fails (no reason logged)

**Log Pattern:**
```
23:19:36 Executor: Action failed BroadcastTradeOffer
```

**Potential Causes:**
1. Trade cooldown logic issue
2. No tradeable items remaining when action executes
3. VillageChat not initialized

**Location:** `src/roles/farming/behaviors/actions/TradeActions.ts`

---

### 8. Explore/PatrolForest Action Failures

**Observed:** 7 Explore failures, 1 PatrolForest failure.

**Symptoms:**
- Actions timeout or return failure
- "Patrol path failed: timeout" logged

**Potential Causes:**
1. No valid exploration directions (all explored recently)
2. Water blocking all paths
3. Bot stuck in corner or cave

**Location:** `src/roles/farming/behaviors/actions/Explore.ts`, `src/roles/lumberjack/behaviors/actions/PatrolForest.ts`

---

### 9. PlantSaplings Action Failures

**Observed:** 3 action failures for PlantSaplings.

**Symptoms:**
- PlantSaplings goal selected but action fails

**Potential Causes:**
1. No valid planting location found
2. Sapling consumed before action could use it
3. Block placement failed

**Location:** `src/roles/lumberjack/behaviors/actions/PlantSaplings.ts`

---

## LOW SEVERITY (Design Issues)

### 10. Goal Cooldown Not Preventing Rapid Re-Selection

**Observed:** Goals being re-selected within 2-3 seconds after planning failure.

**Expected:** 5-second cooldown after goal fails to plan (per `docs/README.md`).

**Symptoms:**
- FollowLumberjack selected → fails → selected again in ~5 seconds
- But sometimes falls back to other goals and returns to failed goal immediately

**Analysis:**
The cooldown may be working but other goals briefly take over before the failed goal's utility beats them again.

**Potential Issue:** Cooldown is goal-specific but the underlying cause (no lumberjack visible) remains, so the cycle continues.

---

### 11. Action Failure Reasons Not Logged

**Observed:** Many action failures logged with no reason.

**Log Pattern:**
```
null: PickupItems - reason=no-reason
null: BroadcastTradeOffer - reason=no-reason
```

**Impact:** Makes debugging difficult.

**Recommendation:** Add reason parameter to action failure logging.

---

### 12. Missing State Key for `nearby.lumberjackDistance`

**Observed:** `nearby.lumberjackDistance` is modified by FollowLumberjackAction's effect but is NOT in `importantFacts` for state deduplication.

**Potential Issue:** Per `docs/goap-planning.md:326-339`, facts modified by actions should be in `importantFacts` to prevent state deduplication bugs.

**Location:** `src/planning/GOAPPlanner.ts:326-346`

---

## Summary Table

| # | Issue | Severity | Count | Impact |
|---|-------|----------|-------|--------|
| 1 | FollowLumberjack fails to plan | HIGH | 24-43/session | Farmer stuck in loop |
| 2 | FulfillNeeds fails to plan | HIGH | 43-77/session | Bots don't receive materials |
| 3 | ObtainTools fails to plan | HIGH | 26-400/session | Farmer can't start farming |
| 4 | FulfillTerraformRequest fails | HIGH | 400/session | Terraform never completed |
| 5 | PickupItems unreachable | HIGH | 21/session | Wasted time on impossible pickups |
| 6 | CraftAxe failures | MEDIUM | 6/session | Delayed tool acquisition |
| 7 | BroadcastTradeOffer failures | MEDIUM | 4/session | Trading disrupted |
| 8 | Explore/Patrol failures | MEDIUM | 8/session | Bot gets stuck |
| 9 | PlantSaplings failures | MEDIUM | 3/session | Forest not sustained |
| 10 | Cooldown not preventing loops | LOW | - | Inefficient behavior |
| 11 | Missing failure reasons | LOW | - | Hard to debug |
| 12 | Missing state key | LOW | - | Potential planning bugs |

---

## Recommended Investigation Order

1. **ObtainTools planning failures (400+ occurrences)** - Most severe; farmer completely stuck. Check if there's a path to get materials when no chest exists.
2. **FulfillTerraformRequest planning failures (400 occurrences)** - Landscaper completely stuck. Check action preconditions.
3. **FulfillNeeds planning failures** - Verify action preconditions match goal utility conditions
4. **FollowLumberjack planning failures** - Add logging to check what WorldState facts exist during planning
5. **PickupItems unreachable loop** - Verify items added to unreachableDrops after failure
6. **Add `nearby.lumberjackDistance` to importantFacts** - May fix planning issues

## Cross-Session Pattern Analysis

| Session | FollowLumberjack | FulfillNeeds | ObtainTools | FulfillTerraform |
|---------|------------------|--------------|-------------|------------------|
| latest (00:16) | 43 | 43 | - | - |
| 22:54 | 33 | 77 | 26 | - |
| 21:48 | 24 | 62 | 400 | 400 |

The high numbers in session 21:48 suggest the bots were stuck in failure loops for extended periods.
