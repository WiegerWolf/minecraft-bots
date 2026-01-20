# Bot Problems & Issues

Log analysis from sessions 2026-01-17 through 2026-01-20. Issues organized by severity and category.

---

## Fixed Issues

### 1. Memory Leak ✅ FIXED
**Status**: Fixed in this session
**Fix Applied**:
- Added `cleanup()` method to VillageChat that removes event listeners
- Added `periodicCleanup()` method that calls `cleanupOldTradeOffers()`, `cleanupOldNeeds()`, `cleanupOldTerraformRequests()`
- Updated all blackboards to call `periodicCleanup()` instead of just `cleanupOldTradeOffers()`
- `cleanupOldNeeds()` and `cleanupOldTerraformRequests()` cleanup functions existed but were never called

**Files Changed**:
- `src/shared/VillageChat.ts` - Added cleanup() and periodicCleanup() methods
- `src/roles/farming/Blackboard.ts` - Changed to call periodicCleanup()
- `src/roles/lumberjack/LumberjackBlackboard.ts` - Changed to call periodicCleanup()
- `src/roles/landscaper/LandscaperBlackboard.ts` - Changed to call periodicCleanup()

### 2. Empty Chest Check Loop (Farmer) ✅ FIXED
**Status**: Fixed in this session
**Fix Applied**:
- Added `chestEmptyUntil` timestamp to farming blackboard
- Added `derived.chestRecentlyEmpty` WorldState fact
- Added precondition to CheckSharedChestAction checking `!chestRecentlyEmpty`
- Set 30-second backoff when chest is found empty

**Files Changed**:
- `src/roles/farming/Blackboard.ts` - Added chestEmptyUntil field
- `src/planning/WorldStateBuilder.ts` - Added derived.chestRecentlyEmpty
- `src/planning/actions/FarmingActions.ts` - Added precondition
- `src/roles/farming/behaviors/actions/CheckSharedChest.ts` - Set backoff on empty

### 3. Forest Finding Infinite Loop (Lumberjack) ✅ FIXED
**Status**: Fixed in this session
**Fix Applied**:
- Added `forestSearchFailedUntil` timestamp to lumberjack blackboard
- Added `derived.forestSearchRecentlyFailed` WorldState fact
- Added precondition to FindForestAction checking `!forestSearchRecentlyFailed`
- Set 60-second backoff after max exploration attempts reached

**Files Changed**:
- `src/roles/lumberjack/LumberjackBlackboard.ts` - Added forestSearchFailedUntil field
- `src/planning/WorldStateBuilder.ts` - Added derived.forestSearchRecentlyFailed
- `src/planning/actions/LumberjackActions.ts` - Added precondition
- `src/roles/lumberjack/behaviors/actions/FindForest.ts` - Set backoff on failure

### 4. BroadcastTradeOffer Spam ✅ FIXED
**Status**: Fixed in this session
**Fix Applied**:
- Added `consecutiveNoTakers` counter to all blackboards
- Implemented exponential backoff in BaseBroadcastOffer: 30s → 60s → 120s → ... → 10min max
- Counter resets when trade is successfully initiated

**Files Changed**:
- `src/shared/actions/BaseTrade.ts` - Added exponential backoff logic
- `src/roles/farming/Blackboard.ts` - Added consecutiveNoTakers field
- `src/roles/lumberjack/LumberjackBlackboard.ts` - Added consecutiveNoTakers field
- `src/roles/landscaper/LandscaperBlackboard.ts` - Added consecutiveNoTakers field

### 5. Bot Stuck in Holes ✅ IMPROVED
**Status**: Improved in this session
**Fix Applied**:
- Added block placement escape method (places cobblestone/dirt to create stairs)
- Added 15-second cooldown between hole escape attempts to prevent spam
- Escape now tries: break blocks → walk out → place blocks → jump escape

**Files Changed**:
- `src/shared/PathfindingUtils.ts` - Added block placement escape step
- `src/roles/GOAPRole.ts` - Added lastHoleEscapeAttempt cooldown

---

## Remaining Issues (Not Fixed Yet)

### 6. Repeated Sign Studying
**Severity**: Medium
**Status**: Not fixed - requires persistent state across hot-reload
**Evidence**: Bots study spawn signs multiple times per session (should be once).
**Root Cause**: Hot-reload restarts lose blackboard state, `hasStudiedSigns` flag resets.
**Required Fix**: Persist critical blackboard state (hasStudiedSigns, knownChests, etc.) to disk/server.

### 7. CheckSharedChest Failures
**Severity**: Medium
**Status**: Partially mitigated by backoff fix (Issue #2)
**Evidence**: Timeout/unreachable errors when checking chest.
**Potential Causes**:
- Chest location invalid or obstructed
- Pathfinding issues to chest location
- With backoff in place, impact is reduced

### 8. CraftHoe Repeated Failures
**Severity**: Medium
**Status**: Not investigated
**Evidence**: CraftHoe action fails repeatedly.
**Potential Causes**:
- No crafting table available
- Missing materials
- Crafting table location unreachable

### 9. Exploration Pathfinding Timeouts
**Severity**: Medium
**Status**: Not investigated
**Evidence**: Explore action fails with timeout.
**Potential Causes**:
- Target too far
- Complex terrain
- Pathfinder timeout too short

### 10. FollowLumberjack Planning Failure
**Severity**: Medium
**Status**: Not investigated
**Evidence**: `Failed to plan for goal goal=FollowLumberjack`
**Potential Causes**:
- Missing action preconditions
- Lumberjack location not known

---

## Low Priority Issues

### 11. World Change Replans
**Severity**: Low (may be normal)
**Evidence**: Frequent "World state changed significantly, requesting replan" messages.

### 12. Goal Thrashing Patterns
**Severity**: Low
**Evidence**: Same goals selected repeatedly at identical utility values.

---

## Tests Added

All fixes include corresponding tests:
- `tests/shared/memory-cleanup.test.ts` - VillageChat cleanup tests
- `tests/scenarios/farmer/chest-backoff.test.ts` - Chest empty backoff tests
- `tests/scenarios/lumberjack/forest-search-backoff.test.ts` - Forest search backoff tests
- `tests/shared/trade-backoff.test.ts` - Trade offer exponential backoff tests

---

## Summary

**Fixed (5/10)**:
1. ✅ Memory Leak - cleanup functions now called
2. ✅ Empty Chest Loop - 30s backoff added
3. ✅ Forest Finding Loop - 60s backoff after max attempts
4. ✅ Trade Offer Spam - exponential backoff (30s → 10min)
5. ✅ Hole Escape - block placement + 15s cooldown

**Remaining (5/10)**:
6. ⏳ Sign Studying - needs persistent state
7. ⏳ CheckSharedChest - mitigated by #2
8. ⏳ CraftHoe - needs investigation
9. ⏳ Exploration Timeouts - needs investigation
10. ⏳ FollowLumberjack - needs investigation
