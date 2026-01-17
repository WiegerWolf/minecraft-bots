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
    CraftAndPlaceCraftingTable,
    ProcessWood,
    PatrolForest,
    PlantSaplings
} from './actions';

/**
 * Creates the lumberjack behavior tree with the following priority order:
 * 1. Pick up nearby items (logs, saplings)
 * 2. Fulfill requests from other bots (only if we have materials and shared chest)
 * 3. Finish harvesting a tree if we started one (clear leaves, replant)
 * 4. Plant saplings if we have them and no active tree harvest
 * 5. Craft and place crafting table at village center if needed
 * 6. Craft chest at village center if needed
 * 7. Deposit logs/planks/sticks if inventory getting full (keeps saplings)
 * 8. Craft axe if no axe and have materials
 * 9. Chop tree - find and chop trees (works with or without village center)
 * 10. Process wood - craft planks/sticks if excess logs
 * 11. Patrol forest - explore for more trees
 */
export function createLumberjackBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Pick up nearby items (always do this first)
        new PickupItems(),

        // Priority 2: Fulfill requests from other bots (only if we have shared chest and materials)
        new Sequence('FulfillPendingRequests', [
            new Condition('HasPendingRequests', bb => bb.hasPendingRequests),
            new Condition('HasChestAccess', bb => bb.sharedChest !== null || bb.nearbyChests.length > 0),
            new Condition('HasSomeMaterials', bb => bb.logCount > 0 || bb.plankCount > 0 || bb.stickCount > 0),
            new FulfillRequests(),
        ]),

        // Priority 3: Finish harvesting a tree we started (leaves, replant)
        new Sequence('FinishTreeHarvest', [
            new Condition('HasActiveTreeHarvest', bb => bb.currentTreeHarvest !== null),
            new FinishTreeHarvest(),
        ]),

        // Priority 4: Plant saplings if we have them and no active tree harvest
        new Sequence('PlantSaplings', [
            new Condition('HasSaplings', bb => bb.saplingCount > 0),
            new Condition('NoActiveTreeHarvest', bb => bb.currentTreeHarvest === null),
            new PlantSaplings(),
        ]),

        // Priority 5: Craft and place crafting table at village center if needed
        new Sequence('CraftAndPlaceCraftingTable', [
            new Condition('HasVillageCenter', bb => bb.villageCenter !== null),
            new Condition('HasMaterialsForCraftingTable', bb => bb.plankCount >= 4 || bb.logCount >= 1),
            new Condition('NoCraftingTableAvailable', bb => bb.sharedCraftingTable === null && bb.nearbyCraftingTables.length === 0),
            new CraftAndPlaceCraftingTable(),
        ]),

        // Priority 6: Craft chest if needed and we have materials
        new Sequence('CraftChestIfNeeded', [
            new Condition('HasVillageCenter', bb => bb.villageCenter !== null),
            new Condition('HasMaterialsForChest', bb => bb.plankCount >= 8 || bb.logCount >= 2),
            new Condition('NoChestAvailable', bb => bb.sharedChest === null && bb.nearbyChests.length === 0),
            new CraftChest(),
        ]),

        // Priority 7: Deposit items if inventory getting full and we have a chest (keeps saplings)
        new Sequence('DepositWhenFull', [
            new Condition('NeedsToDeposit', bb => bb.needsToDeposit),
            new Condition('HasChest', bb => bb.sharedChest !== null || bb.nearbyChests.length > 0),
            new DepositLogs(),
        ]),

        // Priority 8: Craft axe if needed
        new Sequence('GetAxe', [
            new Condition('NoAxe', bb => !bb.hasAxe),
            new Condition('HasMaterialsForAxe', bb => bb.logCount > 0 || bb.plankCount >= 3),
            new CraftAxe(),
        ]),

        // Priority 9: Chop trees (works anywhere - doesn't require village center)
        new Sequence('ChopTrees', [
            new Condition('NotFullInventory', bb => !bb.inventoryFull),
            new ChopTree(),
        ]),

        // Priority 10: Process wood if we need planks for chest/crafting table or have excess logs
        new Sequence('ProcessWoodForChest', [
            new Condition('NeedToProcessWood', bb =>
                (bb.plankCount < 8 && bb.logCount >= 2) || // Need planks for chest
                (bb.plankCount < 4 && bb.logCount >= 1) || // Need planks for crafting table
                bb.logCount >= 8 // Excess logs
            ),
            new ProcessWood(),
        ]),

        // Priority 11: Patrol forest for more trees
        new PatrolForest(),
    ]);
}
