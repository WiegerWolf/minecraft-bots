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
    GatherWood,
    Explore,
    FindFarmCenter,
    WaitAtFarm,
    RepairField,
    SetupFarmChest
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
    GatherWood,
    Explore,
    FindFarmCenter,
    WaitAtFarm,
    RepairField,
    SetupFarmChest
} from './actions';

/**
 * Creates the farming behavior tree with the following priority order:
 * 1. Pick up nearby items (always do this first)
 * 2. Deposit produce to farm chest if inventory full or lots of produce
 * 3. Get tools if needed (craft hoe)
 * 4. Find farm center if we don't have one
 * 5. Setup farm chest if we have resources and no chest yet
 * 6. Repair holes in the farm field
 * 7. Harvest mature crops (also gives seeds!)
 * 8. Plant seeds on empty farmland
 * 9. Till ground to create new farmland
 * 10. Get seeds by breaking grass (only if no mature crops to harvest)
 * 11. Wait at farm if crops growing (have farm center)
 * 12. Explore as last resort
 */
export function createFarmingBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Pick up nearby items (always do this first)
        new PickupItems(),

        // Priority 2: Deposit produce to farm chest
        new DepositItems(),

        // Priority 3: Get tools if needed
        new Sequence('GetTools', [
            new Condition('NeedsHoe', bb => !bb.hasHoe),
            new Selector('ObtainHoe', [
                new CraftHoe(),
                new GatherWood(),
            ])
        ]),

        // Priority 4: Find farm center if we don't have one
        new Sequence('EstablishFarm', [
            new Condition('NoFarmCenter', bb => !bb.farmCenter),
            new FindFarmCenter(),
        ]),

        // Priority 5: Setup farm chest (when we have wood and no chest, or find existing)
        new Sequence('SetupChest', [
            new Condition('NeedsChest', bb =>
                bb.farmCenter !== null &&
                bb.farmChest === null &&
                (bb.logCount >= 2 || bb.plankCount >= 8 || bb.nearbyChests.length > 0)
            ),
            new SetupFarmChest(),
        ]),

        // Priority 6: Repair holes in the farm (from accidental digging)
        new Sequence('RepairFarm', [
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new RepairField(),
        ]),

        // Priority 7: Harvest mature crops (this also provides seeds!)
        new HarvestCrops(),

        // Priority 8: Plant seeds on empty farmland
        new PlantSeeds(),

        // Priority 9: Till ground to create new farmland
        new TillGround(),

        // Priority 10: Get seeds by breaking grass (only if no mature crops available)
        new Sequence('GetSeeds', [
            new Condition('NeedsSeedsAndNoCrops', bb => bb.needsSeeds && bb.nearbyMatureCrops.length === 0),
            new GatherSeeds(),
        ]),

        // Priority 11: Wait at farm if we have one (crops are growing)
        new Sequence('WaitForCrops', [
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new WaitAtFarm(),
        ]),

        // Priority 12: Explore as last resort (only if no farm center)
        new Explore(),
    ]);
}
