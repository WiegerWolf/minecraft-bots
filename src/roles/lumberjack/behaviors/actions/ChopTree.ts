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

        // Use trees from blackboard (already filtered for village distance and reachability)
        // This avoids the issue where startTreeHarvest searches from bot position
        // but we need trees near village center
        if (bb.nearbyTrees.length > 0) {
            // Find closest tree from the pre-filtered list
            const botPos = bot.entity.position;
            const sortedTrees = [...bb.nearbyTrees].sort((a, b) =>
                a.position.distanceTo(botPos) - b.position.distanceTo(botPos)
            );

            for (const tree of sortedTrees) {
                // Double-check village distance if we have a center
                if (bb.villageCenter) {
                    const treeDistFromVillage = tree.position.distanceTo(bb.villageCenter);
                    if (treeDistFromVillage > 60) {
                        bb.log?.debug(`[Lumberjack] Tree at ${tree.position.floored()} too far from village (${Math.round(treeDistFromVillage)} blocks), skipping`);
                        continue;
                    }
                }

                bb.currentTreeHarvest = {
                    basePos: tree.position.clone(),
                    logType: tree.name,
                    phase: 'chopping'
                };
                bb.lastAction = 'chop_tree';
                bb.log?.debug(`[Lumberjack] Starting tree harvest at ${tree.position.floored()}`);
                return this.continueHarvest(bot, bb);
            }
        }

        // Fallback: use startTreeHarvest if no pre-filtered trees
        // (this can happen if blackboard wasn't updated yet)
        const maxDistance = bb.villageCenter ? 50 : 32;
        const state = startTreeHarvest(bot, maxDistance);
        if (!state) return 'failure';

        // If we have a village center, check distance
        if (bb.villageCenter) {
            const treeDistFromVillage = state.basePos.distanceTo(bb.villageCenter);
            if (treeDistFromVillage > 60) {
                bb.log?.debug(`[Lumberjack] Tree too far from village (${Math.round(treeDistFromVillage)} blocks), skipping`);
                return 'failure';
            }
        }

        bb.currentTreeHarvest = state;
        bb.lastAction = 'chop_tree';
        bb.log?.debug(`[Lumberjack] Starting tree harvest at ${state.basePos}`);
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
