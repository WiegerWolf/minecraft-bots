import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import {
    startTreeHarvest,
    continueTreeHarvest,
    type TreeHarvestState
} from '../../../shared/TreeHarvest';

// Re-export TreeHarvestState for backward compatibility
export type { TreeHarvestState } from '../../../shared/TreeHarvest';

/**
 * GatherWood behavior - harvests trees sustainably.
 * Can be used in two modes:
 * 1. startNewTreeOnly=false (default): Continues existing harvest OR starts new if needed
 * 2. startNewTreeOnly=true: Only starts new trees, ignores existing harvest
 */
export class GatherWood implements BehaviorNode {
    name = 'GatherWood';
    private startNewTreeOnly: boolean;

    // Track where we've planted saplings to maintain spacing
    private plantedSaplingPositions: Vec3[] = [];

    constructor(startNewTreeOnly: boolean = false) {
        this.startNewTreeOnly = startNewTreeOnly;
    }

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // If we're only supposed to start new trees (called from GetTools sequence)
        if (this.startNewTreeOnly) {
            if (bb.currentTreeHarvest) return 'failure'; // Let FinishTreeHarvest handle it
            if (bb.hasHoe) return 'failure';
            if (bb.plankCount >= 4) return 'failure';
            if (bb.logCount > 0) return 'failure';

            bb.lastAction = 'gather_wood';
            return this.findAndStartTree(bot, bb);
        }

        // Default mode: finish existing harvest first
        if (bb.currentTreeHarvest) {
            bb.lastAction = 'gather_wood';
            return this.continueHarvest(bot, bb);
        }

        // Only start a new tree if we need wood
        if (bb.hasHoe) return 'failure';
        if (bb.plankCount >= 4) return 'failure';
        if (bb.logCount > 0) return 'failure';

        bb.lastAction = 'gather_wood';

        // Find a new tree to harvest
        return this.findAndStartTree(bot, bb);
    }

    private async findAndStartTree(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        const state = startTreeHarvest(bot, 32);
        if (!state) return 'failure';

        bb.currentTreeHarvest = state;
        return this.continueHarvest(bot, bb);
    }

    private async continueHarvest(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        const result = await continueTreeHarvest(bot, bb.currentTreeHarvest, this.plantedSaplingPositions);

        if (result === 'done') {
            bb.currentTreeHarvest = null;
            this.plantedSaplingPositions = [];
            return 'failure'; // Allow other behaviors to run
        }

        return result === 'success' ? 'success' : 'failure';
    }
}
