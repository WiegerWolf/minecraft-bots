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
    SetupFarmChest,
    ClearFarmArea,
    RequestMaterials,
    CheckSharedChest
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
    SetupFarmChest,
    ClearFarmArea,
    RequestMaterials,
    CheckSharedChest
} from './actions';

/**
 * Creates the farming behavior tree with the following priority order:
 * 1. Pick up nearby items (always do this first)
 * 2. Finish harvesting a tree if we started one (clear leaves, replant) - kept for clearing trees that block farm
 * 3. Deposit produce to farm chest if inventory full or lots of produce
 * 4. Find farm center if we don't have one (BEFORE tools - need to explore first!)
 * 5. Get tools if needed (only after we have a farm center or can craft locally)
 * 6. Clear farm area (remove trees, level terrain)
 * 7. Setup farm chest if we have resources and no chest yet
 * 8. Repair holes in the farm field
 * 9. Harvest mature crops (also gives seeds!)
 * 10. Plant seeds on empty farmland
 * 11. Till ground to create new farmland
 * 12. Get seeds by breaking grass (only if no mature crops to harvest)
 * 13. Wait at farm if crops growing (have farm center)
 * 14. Explore as last resort
 */
export function createFarmingBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Pick up nearby items (always do this first)
        new PickupItems(),

        // Priority 2: Finish harvesting a tree we started (leaves, replant)
        // Keep this for clearing trees that block the farm
        new Sequence('FinishTreeHarvest', [
            new Condition('HasActiveTreeHarvest', bb => bb.currentTreeHarvest !== null),
            new GatherWood(),  // Will continue the harvest
        ]),

        // Priority 3: Deposit produce to farm chest
        new DepositItems(),

        // Priority 4: Find farm center if we don't have one (BEFORE tools!)
        new Sequence('EstablishFarm', [
            new Condition('NoFarmCenter', bb => !bb.farmCenter),
            new FindFarmCenter(),
        ]),

        // Priority 5: Get tools if needed - only after we have a farm center
        new Sequence('GetTools', [
            new Condition('NeedsHoe', bb => !bb.hasHoe),
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new Selector('ObtainHoe', [
                // First, try to craft if we have materials
                new Sequence('CraftIfPossible', [
                    new Condition('HasMaterials', bb => bb.stickCount >= 2 && bb.plankCount >= 2),
                    new CraftHoe(),
                ]),
                // Otherwise, check shared chest for materials
                new CheckSharedChest(),
                // If still no materials, request from lumberjack
                new RequestMaterials(),
            ])
        ]),

        // Priority 6: Clear farm area (remove trees, level terrain around water)
        new ClearFarmArea(),

        // Priority 7: Setup farm chest (after farm is established and no chest yet)
        new Sequence('SetupChest', [
            new Condition('NeedsChest', bb =>
                bb.farmCenter !== null &&
                bb.farmChest === null
            ),
            new SetupFarmChest(),
        ]),

        // Priority 8: Repair holes in the farm (from accidental digging)
        new Sequence('RepairFarm', [
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new RepairField(),
        ]),

        // Priority 9: Harvest mature crops (this also provides seeds!)
        new HarvestCrops(),

        // Priority 10: Plant seeds on empty farmland
        new PlantSeeds(),

        // Priority 11: Till ground to create new farmland
        new TillGround(),

        // Priority 12: Get seeds by breaking grass (only if no mature crops available)
        new Sequence('GetSeeds', [
            new Condition('NeedsSeedsAndNoCrops', bb => bb.needsSeeds && bb.nearbyMatureCrops.length === 0),
            new GatherSeeds(),
        ]),

        // Priority 13: Wait at farm if we have one (crops are growing)
        new Sequence('WaitForCrops', [
            new Condition('HasFarmCenter', bb => bb.farmCenter !== null),
            new WaitAtFarm(),
        ]),

        // Priority 14: Explore as last resort (only if no farm center)
        new Explore(),
    ]);
}
