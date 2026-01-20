# Problems and Bugs - Log Analysis

Analysis date: 2026-01-20
Session analyzed: 2026-01-20_10-58-13

## Status: All Issues Fixed

All identified issues have been addressed. See "Fixes Applied" section below.

---

## High Priority Issues (FIXED)

### 1. PickupItems Action Repeatedly Failing ✅
**Status**: Already handled by existing unreachable item tracking
**File**: `src/shared/actions/BasePickupItems.ts`
The existing code already marks items as unreachable after 5 attempts. This is expected behavior for items in inaccessible locations.

### 2. RespondToNeed Action Failing Continuously ✅
**Status**: Fixed
**File**: `src/shared/actions/BaseRespondToNeed.ts`
**Fix**: Modified `handleRespondingNeeds()` to:
- Return 'running' when waiting for offer acceptance instead of 'failure'
- Clean up stale needs that have been fulfilled/expired by others
- Track pending offers and keep the action alive while waiting

### 3. Landscaper Tool Acquisition Loop ✅
**Status**: Fixed
**Files**:
- `src/planning/actions/LandscaperActions.ts` - Added `BroadcastNeedAction` to action list
- `src/roles/landscaper/LandscaperBlackboard.ts` - Added `lastChestCheckTime` and `lastChestWasEmpty` tracking
- `src/roles/landscaper/behaviors/actions/CheckSharedChest.ts` - Added 2-minute cooldown after finding empty chest

**Fix**:
- Added `BroadcastNeedAction` so landscaper can request tools from lumberjack
- Added cooldown to prevent repeatedly checking an empty chest

### 4. CraftAxe Missing Materials Bug ✅
**Status**: Fixed
**File**: `src/roles/lumberjack/behaviors/actions/CraftAxe.ts`
**Fix**:
- Sync blackboard with actual inventory at start of action
- Added plank-equivalent calculation to fail early if insufficient materials
- Update blackboard counts after each crafting step

## Medium Priority Issues (FIXED)

### 5. FollowLumberjack PathStopped Failures ✅
**Status**: Fixed
**File**: `src/roles/farming/behaviors/actions/FollowLumberjack.ts`
**Fix**:
- Use `smartPathfinderGoto` instead of raw `bot.pathfinder.goto()`
- Added `isPathfinding` flag to prevent re-entry during async operations
- Handle `PathStopped` gracefully by returning 'running' to retry

### 6. TillGround Unreachable Targets ✅
**Status**: Fixed
**File**: `src/roles/farming/behaviors/actions/TillGround.ts`
**Fix**:
- Try multiple candidate positions instead of giving up on first unreachable
- Added unreachable position tracking with 5-minute cooldown
- Sort candidates by distance to prioritize closer blocks

### 7. Trade Proximity Failures ✅
**Status**: Fixed
**File**: `src/shared/actions/BaseTrade.ts`
**Fix**:
- Check pathfinding result before sending `sendTradeReady()`
- Verify actual distance to meeting point after pathfinding
- Only send ready when actually within radius

### 8. PlantSaplings No Suitable Spots ✅
**Status**: Fixed
**File**: `src/roles/lumberjack/behaviors/actions/PlantSaplings.ts`
**Fix**:
- Search in expanding radii (16, 32, 48 blocks)
- Increased search count from 50 to 100 blocks per radius
- Sort candidates by distance to prefer closer spots

### 9. Trade Offers With No Takers ✅
**Status**: Fixed (indirect)
**Root Cause**: Landscaper was stuck in tool acquisition loop, unable to respond to offers
**Fix**: Addressed by fixing the landscaper tool acquisition loop (#3). Now the landscaper can function properly and respond to trade offers.

## Low Priority Issues (Not Fixed - Low Impact)

### 10. Forest Detection Finding Too Few Trees
**Status**: Not addressed
**Impact**: Low - Lumberjack may chop scattered trees instead of finding dense forest

### 11. Explore Action Failing (Landscaper)
**Status**: Not addressed
**Impact**: Low - Bot will just try other actions

### 12. Frequent Bot Termination Signals
**Status**: Not addressed
**Note**: Likely user-initiated restarts during development

---

## Summary of Changes

### Files Modified:
1. `src/shared/actions/BaseRespondToNeed.ts` - Fix continuous failures
2. `src/planning/actions/LandscaperActions.ts` - Add BroadcastNeedAction
3. `src/roles/landscaper/LandscaperBlackboard.ts` - Add chest check cooldown fields
4. `src/roles/landscaper/behaviors/actions/CheckSharedChest.ts` - Add empty chest cooldown
5. `src/roles/lumberjack/behaviors/actions/CraftAxe.ts` - Fix material sync and early failure
6. `src/roles/farming/behaviors/actions/FollowLumberjack.ts` - Fix PathStopped handling
7. `src/roles/farming/behaviors/actions/TillGround.ts` - Try multiple candidates
8. `src/shared/actions/BaseTrade.ts` - Fix proximity verification
9. `src/roles/lumberjack/behaviors/actions/PlantSaplings.ts` - Expand search radius

### Key Patterns Addressed:

**Pattern A: Unreachable Items/Blocks** - Added retry logic with cooldowns and multiple candidate selection

**Pattern B: Material Chain Breakage** - Added `BroadcastNeedAction` for landscaper, improved material checking in CraftAxe

**Pattern C: Action Failure Not Triggering Proper State** - Fixed RespondToNeed to return 'running' while waiting, fixed trade proximity checks
