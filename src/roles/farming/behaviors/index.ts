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
    Explore
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
    Explore
} from './actions';

/**
 * Creates the farming behavior tree with the following priority order:
 * 1. Pick up nearby items (always do this first)
 * 2. Deposit if inventory full
 * 3. Get tools if needed (craft hoe)
 * 4. Main farming loop (harvest, plant, till)
 * 5. Get seeds if needed
 * 6. Explore as last resort
 */
export function createFarmingBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Pick up nearby items (always do this first)
        new PickupItems(),

        // Priority 2: Deposit if inventory full
        new DepositItems(),

        // Priority 3: Get tools if needed
        new Sequence('GetTools', [
            new Condition('NeedsHoe', bb => !bb.hasHoe),
            new Selector('ObtainHoe', [
                new CraftHoe(),
                new GatherWood(),
            ])
        ]),

        // Priority 4: Main farming loop
        new Selector('FarmingWork', [
            new HarvestCrops(),
            new PlantSeeds(),
            new TillGround(),
        ]),

        // Priority 5: Get seeds if needed
        new Sequence('GetSeeds', [
            new Condition('NeedsSeeds', bb => bb.needsSeeds),
            new GatherSeeds(),
        ]),

        // Priority 6: Explore as last resort
        new Explore(),
    ]);
}
