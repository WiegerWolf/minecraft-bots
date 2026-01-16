// Re-export types
export type { BehaviorStatus, BehaviorNode } from './types';

// Re-export composites
export { Selector, Sequence, Condition } from './composites';

// Re-export actions
export {
    PickupItems,
    ChopTree,
    FinishTreeHarvest,
    FulfillRequests,
    DepositLogs,
    CraftAxe,
    ProcessWood,
    PatrolForest
} from './actions';

// Import for tree building
import type { BehaviorNode } from './types';
import { Selector, Sequence, Condition } from './composites';
import {
    PickupItems,
    ChopTree,
    FinishTreeHarvest,
    FulfillRequests,
    DepositLogs,
    CraftAxe,
    CraftChest,
    ProcessWood,
    PatrolForest
} from './actions';

/**
 * Creates the lumberjack behavior tree with the following priority order:
 * 1. Pick up nearby items (logs, saplings)
 * 2. Finish harvesting a tree if we started one (clear leaves, replant)
 * 3. Fulfill requests from other bots (only if we have materials and shared chest)
 * 4. Deposit logs/planks/sticks if inventory getting full
 * 5. Craft axe if no axe and have materials
 * 6. Chop tree - find and chop trees (works with or without village center)
 * 7. Process wood - craft planks/sticks if excess logs
 * 8. Patrol forest - explore for more trees
 */
export function createLumberjackBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Pick up nearby items (always do this first)
        new PickupItems(),

        // Priority 2: Finish harvesting a tree we started (leaves, replant)
        new Sequence('FinishTreeHarvest', [
            new Condition('HasActiveTreeHarvest', bb => bb.currentTreeHarvest !== null),
            new FinishTreeHarvest(),
        ]),

        // Priority 3: Fulfill requests from other bots (only if we have shared chest and materials)
        new Sequence('FulfillPendingRequests', [
            new Condition('HasPendingRequests', bb => bb.hasPendingRequests),
            new Condition('HasChestAccess', bb => bb.sharedChest !== null || bb.nearbyChests.length > 0),
            new Condition('HasSomeMaterials', bb => bb.logCount > 0 || bb.plankCount > 0 || bb.stickCount > 0),
            new FulfillRequests(),
        ]),

        // Priority 4: Craft chest if needed and we have materials
        new Sequence('CraftChestIfNeeded', [
            new Condition('NeedsToDeposit', bb => bb.needsToDeposit),
            new Condition('NoChestAvailable', bb => bb.sharedChest === null && bb.nearbyChests.length === 0),
            new Condition('HasMaterialsForChest', bb => bb.plankCount >= 8 || bb.logCount >= 2),
            new CraftChest(),
        ]),

        // Priority 5: Deposit items if inventory getting full and we have a chest
        new Sequence('DepositWhenFull', [
            new Condition('NeedsToDeposit', bb => bb.needsToDeposit),
            new Condition('HasChest', bb => bb.sharedChest !== null || bb.nearbyChests.length > 0),
            new DepositLogs(),
        ]),

        // Priority 5: Craft axe if needed
        new Sequence('GetAxe', [
            new Condition('NoAxe', bb => !bb.hasAxe),
            new Condition('HasMaterialsForAxe', bb => bb.logCount > 0 || bb.plankCount >= 3),
            new CraftAxe(),
        ]),

        // Priority 6: Chop trees (works anywhere - doesn't require village center)
        new Sequence('ChopTrees', [
            new Condition('NotFullInventory', bb => !bb.inventoryFull),
            new ChopTree(),
        ]),

        // Priority 7: Process wood if we have excess logs
        new Sequence('ProcessExcessWood', [
            new Condition('HasExcessLogs', bb => bb.logCount >= 8),
            new ProcessWood(),
        ]),

        // Priority 8: Patrol forest for more trees
        new PatrolForest(),
    ]);
}
