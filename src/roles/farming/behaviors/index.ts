// Re-export types
export type { BehaviorStatus, BehaviorNode } from './types';

// Re-export composites
export { Selector, Sequence, Condition } from './composites';

// Re-export actions
export {
    PickupItems,
    DepositItems,
    HarvestCrops,
    PlantSeeds,
    TillGround,
    GatherSeeds,
    CraftHoe,
    Explore,
    FindFarmCenter,
    WaitAtFarm,
    RepairField,
    SetupFarmChest,
    ClearFarmArea,
    BroadcastNeed,
    CheckSharedChest,
    BroadcastOffer,
    RespondToOffer,
    CompleteTrade
} from './actions';

// Import for tree building
import type { BehaviorNode } from './types';
import { Selector, Sequence, Condition } from './composites';
import {
    PickupItems,
    DepositItems,
    HarvestCrops,
    PlantSeeds,
    TillGround,
    GatherSeeds,
    CraftHoe,
    Explore,
    FindFarmCenter,
    WaitAtFarm,
    RepairField,
    SetupFarmChest,
    ClearFarmArea,
    BroadcastNeed,
    CheckSharedChest,
    BroadcastOffer,
    RespondToOffer,
    CompleteTrade
} from './actions';

/**
 * Creates the farming behavior tree with the following priority order:
 * 1. Complete active trade (highest priority - finish what we started)
 * 2. Pick up nearby items (always do this first)
 * 3. Deposit produce to farm chest if inventory full or lots of produce
 * 4. Respond to trade offers for items we want
 * 5. Find farm center if we don't have one (BEFORE tools - need to explore first!)
 * 6. Get tools if needed (only after we have a farm center or can craft locally)
 *    - Farmer broadcasts need for hoe, other bots offer to help
 * 7. Clear farm area (remove trees, level terrain)
 * 8. Setup farm chest if we have resources and no chest yet
 * 9. Repair holes in the farm field
 * 10. Harvest mature crops (also gives seeds!)
 * 11. Plant seeds on empty farmland
 * 12. Till ground to create new farmland
 * 13. Get seeds by breaking grass (only if no mature crops to harvest)
 * 14. Broadcast trade offer (if have 4+ unwanted items)
 * 15. Wait at farm if crops growing (have farm center)
 * 16. Explore as last resort
 */
export function createFarmingBehaviorTree(): BehaviorNode {
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

        // Priority 3: Deposit produce to farm chest
        new DepositItems(),

        // Priority 4: Respond to trade offers for items we want (medium priority)
        new Sequence('RespondToTradeOffer', [
            new Condition('HasWantedOffer', bb =>
                bb.pendingTradeOffers.length > 0 &&
                (!bb.villageChat || !bb.villageChat.isInTrade())
            ),
            new RespondToOffer(),
        ]),

        // Priority 5: Find farm center if we don't have one (BEFORE tools!)
        new Sequence('EstablishFarm', [
            new Condition('NoFarmCenter', bb => !bb.farmCenter),
            new FindFarmCenter(),
        ]),

        // Priority 6: Get tools if needed - only after we have a farm center
        // Farmer broadcasts need for hoe, other bots offer to help
        new Sequence('GetTools', [
            new Condition('NeedsHoe', bb => !bb.hasHoe),
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new Selector('ObtainHoe', [
                // First, try to craft if we have materials (logs or planks + sticks)
                new Sequence('CraftIfPossible', [
                    new Condition('HasMaterials', bb =>
                        (bb.stickCount >= 2 && bb.plankCount >= 2) ||
                        bb.logCount >= 2  // 2 logs = 8 planks = enough for sticks + hoe
                    ),
                    new CraftHoe(),
                ]),
                // Otherwise, check shared chest for materials (logs, planks, sticks)
                new CheckSharedChest(),
                // If still no materials, broadcast need for hoe
                new BroadcastNeed(),
            ])
        ]),

        // Priority 7: Clear farm area (remove trees, level terrain around water)
        new ClearFarmArea(),

        // Priority 8: Setup farm chest (after farm is established and no chest yet)
        new Sequence('SetupChest', [
            new Condition('NeedsChest', bb =>
                bb.farmCenter !== null &&
                bb.farmChest === null
            ),
            new SetupFarmChest(),
        ]),

        // Priority 9: Repair holes in the farm (from accidental digging)
        new Sequence('RepairFarm', [
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new RepairField(),
        ]),

        // Priority 10: Harvest mature crops (this also provides seeds!)
        new HarvestCrops(),

        // Priority 11: Plant seeds on empty farmland
        new PlantSeeds(),

        // Priority 12: Till ground to create new farmland
        new TillGround(),

        // Priority 13: Get seeds by breaking grass (only if no mature crops available)
        new Sequence('GetSeeds', [
            new Condition('NeedsSeedsAndNoCrops', bb => bb.needsSeeds && bb.nearbyMatureCrops.length === 0),
            new GatherSeeds(),
        ]),

        // Priority 14: Broadcast trade offer when idle with unwanted items
        new Sequence('BroadcastTradeOffer', [
            new Condition('HasTradeableItems', bb =>
                bb.tradeableItemCount >= 4 &&
                (!bb.villageChat || !bb.villageChat.isInTrade()) &&
                Date.now() - bb.lastOfferTime >= 30000  // 30s cooldown
            ),
            new BroadcastOffer(),
        ]),

        // Priority 15: Wait at farm if we have one (crops are growing)
        new Sequence('WaitForCrops', [
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new WaitAtFarm(),
        ]),

        // Priority 16: Explore as last resort (only if no farm center)
        new Explore(),
    ]);
}
