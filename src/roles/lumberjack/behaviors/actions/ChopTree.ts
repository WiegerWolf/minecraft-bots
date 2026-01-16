import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import {
    startTreeHarvest,
    continueTreeHarvest,
} from '../../../shared/TreeHarvest';

/**
 * ChopTree - Find and chop trees, uses shared TreeHarvest logic
 */
export class ChopTree implements BehaviorNode {
    name = 'ChopTree';

    // Track where we've planted saplings to maintain spacing
    private plantedSaplingPositions: Vec3[] = [];

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Continue existing harvest
        if (bb.currentTreeHarvest) {
            bb.lastAction = 'chop_tree';
            return this.continueHarvest(bot, bb);
        }

        // Don't start new trees if inventory full
        if (bb.inventoryFull) return 'failure';

        // Find a tree to harvest within village radius if we have a center
        const maxDistance = bb.villageCenter ? 50 : 32;

        const state = startTreeHarvest(bot, maxDistance);
        if (!state) return 'failure';

        // If we have a village center, prefer trees near it
        if (bb.villageCenter) {
            const treeDistFromVillage = state.basePos.distanceTo(bb.villageCenter);
            if (treeDistFromVillage > 60) {
                console.log(`[Lumberjack] Tree too far from village (${Math.round(treeDistFromVillage)} blocks), skipping`);
                return 'failure';
            }
        }

        bb.currentTreeHarvest = state;
        bb.lastAction = 'chop_tree';
        console.log(`[Lumberjack] Starting tree harvest at ${state.basePos}`);
        return this.continueHarvest(bot, bb);
    }

    private async continueHarvest(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        const result = await continueTreeHarvest(bot, bb.currentTreeHarvest, this.plantedSaplingPositions);

        if (result === 'done') {
            bb.currentTreeHarvest = null;
            this.plantedSaplingPositions = [];
            return 'success'; // Tree fully harvested
        }

        return result === 'success' ? 'success' : 'failure';
    }
}

/**
 * FinishTreeHarvest - Continue an in-progress tree harvest (leaves, replant)
 */
export class FinishTreeHarvest implements BehaviorNode {
    name = 'FinishTreeHarvest';

    private plantedSaplingPositions: Vec3[] = [];

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        bb.lastAction = 'finish_tree_harvest';
        const result = await continueTreeHarvest(bot, bb.currentTreeHarvest, this.plantedSaplingPositions);

        if (result === 'done') {
            bb.currentTreeHarvest = null;
            this.plantedSaplingPositions = [];
            return 'success';
        }

        return result === 'success' ? 'success' : 'failure';
    }
}
