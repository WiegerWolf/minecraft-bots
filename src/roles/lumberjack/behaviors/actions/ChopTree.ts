import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import {
    startTreeHarvest,
    continueTreeHarvest,
} from '../../../shared/TreeHarvest';
import { shouldPreemptForTrade } from '../../../../shared/TradePreemption';

/**
 * ChopTree - Find and chop trees, uses shared TreeHarvest logic
 *
 * IMPORTANT: Only chops trees from forestTrees (verified forest areas).
 * This prevents dismantling villager houses or other structures.
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

        // SAFETY: Only use forestTrees - trees verified to be in actual forests
        // This prevents dismantling villager houses or other structures!
        if (bb.forestTrees.length === 0) {
            bb.log?.debug('No forest trees available - refusing to chop isolated trees');
            return 'failure';
        }

        // Find closest tree from the pre-filtered forest trees
        const botPos = bot.entity.position;
        const sortedTrees = [...bb.forestTrees].sort((a, b) =>
            a.position.distanceTo(botPos) - b.position.distanceTo(botPos)
        );

        for (const tree of sortedTrees) {
            // Double-check village distance if we have a center
            if (bb.villageCenter) {
                const treeDistFromVillage = tree.position.distanceTo(bb.villageCenter);
                if (treeDistFromVillage > 60) {
                    bb.log?.debug(`Tree at ${tree.position.floored()} too far from village (${Math.round(treeDistFromVillage)} blocks), skipping`);
                    continue;
                }
            }

            bb.currentTreeHarvest = {
                basePos: tree.position.clone(),
                logType: tree.name,
                phase: 'chopping'
            };
            bb.lastAction = 'chop_tree';
            bb.log?.info({ pos: tree.position.floored().toString() }, 'Starting forest tree harvest');
            return this.continueHarvest(bot, bb);
        }

        // No valid forest trees found
        bb.log?.debug('No valid forest trees in range');
        return 'failure';
    }

    private async continueHarvest(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        if (!bb.currentTreeHarvest) return 'failure';

        // Check for preemption before starting new operations
        // Note: We still complete the current operation if already busy
        if (!bb.currentTreeHarvest.busy && shouldPreemptForTrade(bb, 'lumberjack')) {
            bb.log?.debug('ChopTree preempted for trade');
            return 'failure';
        }

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
