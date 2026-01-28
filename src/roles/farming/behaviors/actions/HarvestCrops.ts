import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { GoalNear } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';
import { shouldPreemptForTrade } from '../../../../shared/TradePreemption';

export class HarvestCrops implements BehaviorNode {
    name = 'HarvestCrops';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canHarvest) return 'failure';

        const allCrops = bb.nearbyMatureCrops;
        if (allCrops.length === 0) return 'failure';

        bb.lastAction = 'harvest';

        // Find the best cluster of crops to harvest (most crops within reach)
        const clusterRadius = 4;
        let bestCluster: typeof allCrops = [];
        let bestClusterCenter = allCrops[0]!;

        for (const crop of allCrops) {
            const nearby = allCrops.filter(c =>
                c.position.distanceTo(crop.position) <= clusterRadius
            );
            if (nearby.length > bestCluster.length) {
                bestCluster = nearby;
                bestClusterCenter = crop;
            }
        }

        if (bestCluster.length === 0) return 'failure';

        // Move to cluster if needed
        const distToCluster = bot.entity.position.distanceTo(bestClusterCenter.position);
        if (distToCluster > 4) {
            bb.log?.debug(`[BT] Moving to crop cluster at ${bestClusterCenter.position} (${Math.round(distToCluster)} blocks away, ${bestCluster.length} crops)`);
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(bestClusterCenter.position.x, bestClusterCenter.position.y, bestClusterCenter.position.z, 3),
                { timeoutMs: 10000 }
            );
            if (!result.success) {
                bb.log?.debug(`[BT] Failed to reach crop cluster: ${result.failureReason}`);
                return 'failure';
            }
            bot.pathfinder.stop();

            // Check for preemption after pathfinding
            if (shouldPreemptForTrade(bb, 'farmer')) {
                bb.log?.debug('HarvestCrops preempted for trade after pathfinding');
                return 'failure';
            }
        }

        // Harvest all reachable crops in the cluster
        let harvestedCount = 0;
        for (const crop of bestCluster) {
            // Check for preemption - higher priority goal needs attention
            if (shouldPreemptForTrade(bb, 'farmer')) {
                bb.log?.debug({ harvestedCount }, 'HarvestCrops preempted for trade');
                return harvestedCount > 0 ? 'success' : 'failure';
            }

            const dist = bot.entity.position.distanceTo(crop.position);
            if (dist > 4.5) continue; // Too far to reach

            try {
                await bot.lookAt(crop.position.offset(0.5, 0.5, 0.5), true);
                const currentBlock = bot.blockAt(crop.position);
                if (!currentBlock || !this.isMatureCrop(currentBlock)) continue;

                bb.log?.debug(`[BT] Harvesting ${currentBlock.name} at ${crop.position}`);
                await bot.dig(currentBlock);
                harvestedCount++;
                await sleep(50); // Shorter delay between harvests

                // Immediately replant on the farmland below
                const farmlandPos = crop.position.offset(0, -1, 0);
                const farmland = bot.blockAt(farmlandPos);
                if (farmland?.name === 'farmland') {
                    await this.replant(bot, bb, farmland);
                }
            } catch {
                // Continue to next crop
            }
        }

        if (harvestedCount > 0) {
            bb.log?.debug(`[BT] Harvested ${harvestedCount} crops`);
            return 'success';
        }

        return 'failure';
    }

    private isMatureCrop(block: any): boolean {
        if (!block?.name) return false;
        const crops: Record<string, number> = {
            'wheat': 7, 'carrots': 7, 'potatoes': 7, 'beetroots': 3
        };
        const maxAge = crops[block.name];
        if (maxAge === undefined) return false;
        const props = block.getProperties();
        return props.age !== undefined && parseInt(String(props.age)) >= maxAge;
    }

    private async replant(bot: Bot, bb: FarmingBlackboard, farmland: any): Promise<void> {
        // Find a seed to plant
        const seedTypes = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'];
        const seedItem = bot.inventory.items().find(i => seedTypes.includes(i.name));
        if (!seedItem) return;

        try {
            await bot.equip(seedItem, 'hand');
            await bot.lookAt(farmland.position.offset(0.5, 1, 0.5), true);
            await bot.placeBlock(farmland, new Vec3(0, 1, 0));
            await sleep(50);
        } catch {
            // Ignore replant failures
        }
    }
}
