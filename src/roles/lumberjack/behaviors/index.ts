// Re-export types
export type { BehaviorStatus, BehaviorNode } from './types';

// Re-export composites
export { Selector, Sequence, Condition } from './composites';

// Re-export actions
export {
    PickupItems,
    ChopTree,
    FinishTreeHarvest,
    RespondToNeed,
    DepositLogs,
    CraftAxe,
    ProcessWood,
    PatrolForest,
    BroadcastOffer,
    RespondToOffer,
    CompleteTrade
} from './actions';

// Import for tree building
import type { BehaviorNode } from './types';
import { Selector, Sequence, Condition } from './composites';
import {
    PickupItems,
    ChopTree,
    FinishTreeHarvest,
    RespondToNeed,
    DepositLogs,
    CraftAxe,
    CraftChest,
    CraftAndPlaceCraftingTable,
    ProcessWood,
    PatrolForest,
    PlantSaplings,
    BroadcastOffer,
    RespondToOffer,
    CompleteTrade
} from './actions';

/**
 * Creates the lumberjack behavior tree with the following priority order:
 * 1. Complete active trade (highest priority - finish what we started)
 * 2. Pick up nearby items (logs, saplings)
 * 3. Respond to needs from other bots (intent-based fulfillment)
 * 4. Respond to trade offers for items we want
 * 5. Finish harvesting a tree if we started one (clear leaves, replant)
 * 6. Plant saplings if we have them and no active tree harvest
 * 7. Craft and place crafting table at village center if needed
 * 8. Craft chest at village center if needed
 * 9. Deposit logs/planks/sticks if inventory getting full (keeps saplings)
 * 10. Craft axe if no axe and have materials
 * 11. Chop tree - find and chop trees (works with or without village center)
 * 12. Process wood - craft planks/sticks if excess logs
 * 13. Broadcast trade offer (if have 4+ unwanted items)
 * 14. Patrol forest - explore for more trees
 */
export function createLumberjackBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Complete active trade (highest priority - finish what we started)
        new Sequence('CompleteTrade', [
            new Condition('IsInActiveTrade', bb =>
                bb.activeTrade !== null &&
                ['accepted', 'traveling', 'ready', 'dropping', 'picking_up'].includes(bb.activeTrade.status)
            ),
            new CompleteTrade(),
        ]),

        // Priority 2: Pick up nearby items (always do this first)
        new PickupItems(),

        // Priority 3: Respond to needs from other bots (only if we have materials to help)
        new Sequence('RespondToNeeds', [
            new Condition('HasIncomingNeeds', bb => bb.hasIncomingNeeds),
            new Condition('HasSomeMaterials', bb => bb.logCount > 0 || bb.plankCount > 0 || bb.stickCount > 0),
            new RespondToNeed(),
        ]),

        // Priority 4: Respond to trade offers for items we want (medium priority)
        new Sequence('RespondToTradeOffer', [
            new Condition('HasWantedOffer', bb =>
                bb.pendingTradeOffers.length > 0 &&
                (!bb.villageChat || !bb.villageChat.isInTrade())
            ),
            new RespondToOffer(),
        ]),

        // Priority 5: Finish harvesting a tree we started (leaves, replant)
        new Sequence('FinishTreeHarvest', [
            new Condition('HasActiveTreeHarvest', bb => bb.currentTreeHarvest !== null),
            new FinishTreeHarvest(),
        ]),

        // Priority 6: Plant saplings if we have them and no active tree harvest
        new Sequence('PlantSaplings', [
            new Condition('HasSaplings', bb => bb.saplingCount > 0),
            new Condition('NoActiveTreeHarvest', bb => bb.currentTreeHarvest === null),
            new PlantSaplings(),
        ]),

        // Priority 7: Craft and place crafting table at village center if needed
        new Sequence('CraftAndPlaceCraftingTable', [
            new Condition('HasVillageCenter', bb => bb.villageCenter !== null),
            new Condition('HasMaterialsForCraftingTable', bb => bb.plankCount >= 4 || bb.logCount >= 1),
            new Condition('NoCraftingTableAvailable', bb => bb.sharedCraftingTable === null && bb.nearbyCraftingTables.length === 0),
            new CraftAndPlaceCraftingTable(),
        ]),

        // Priority 8: Craft chest if needed and we have materials
        new Sequence('CraftChestIfNeeded', [
            new Condition('HasVillageCenter', bb => bb.villageCenter !== null),
            new Condition('HasMaterialsForChest', bb => bb.plankCount >= 8 || bb.logCount >= 2),
            new Condition('NoChestAvailable', bb => bb.sharedChest === null && bb.nearbyChests.length === 0),
            new CraftChest(),
        ]),

        // Priority 9: Deposit items if inventory getting full and we have a chest (keeps saplings)
        new Sequence('DepositWhenFull', [
            new Condition('NeedsToDeposit', bb => bb.needsToDeposit),
            new Condition('HasChest', bb => bb.sharedChest !== null || bb.nearbyChests.length > 0),
            new DepositLogs(),
        ]),

        // Priority 10: Craft axe if needed
        new Sequence('GetAxe', [
            new Condition('NoAxe', bb => !bb.hasAxe),
            new Condition('HasMaterialsForAxe', bb => bb.logCount > 0 || bb.plankCount >= 3),
            new CraftAxe(),
        ]),

        // Priority 11: Chop trees (works anywhere - doesn't require village center)
        new Sequence('ChopTrees', [
            new Condition('NotFullInventory', bb => !bb.inventoryFull),
            new ChopTree(),
        ]),

        // Priority 12: Process wood if we need planks for chest/crafting table or have excess logs
        new Sequence('ProcessWoodForChest', [
            new Condition('NeedToProcessWood', bb =>
                (bb.plankCount < 8 && bb.logCount >= 2) || // Need planks for chest
                (bb.plankCount < 4 && bb.logCount >= 1) || // Need planks for crafting table
                bb.logCount >= 8 // Excess logs
            ),
            new ProcessWood(),
        ]),

        // Priority 13: Broadcast trade offer when idle with unwanted items
        new Sequence('BroadcastTradeOffer', [
            new Condition('HasTradeableItems', bb =>
                bb.tradeableItemCount >= 4 &&
                (!bb.villageChat || !bb.villageChat.isInTrade()) &&
                Date.now() - bb.lastOfferTime >= 30000  // 30s cooldown
            ),
            new BroadcastOffer(),
        ]),

        // Priority 14: Patrol forest for more trees
        new PatrolForest(),
    ]);
}
