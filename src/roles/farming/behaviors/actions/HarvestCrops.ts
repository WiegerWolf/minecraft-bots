import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { sleep } from './utils';

const { GoalNear } = goals;

export class HarvestCrops implements BehaviorNode {
    name = 'HarvestCrops';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canHarvest) return 'failure';

        // Harvest multiple crops in one go (up to 5)
        const cropsToHarvest = bb.nearbyMatureCrops.slice(0, 5);
        if (cropsToHarvest.length === 0) return 'failure';

        bb.lastAction = 'harvest';
        let harvestedAny = false;

        for (const crop of cropsToHarvest) {
            try {
                // Get within 3 blocks (can dig from this distance)
                const dist = bot.entity.position.distanceTo(crop.position);
                if (dist > 4) {
                    console.log(`[BT] Moving to crop at ${crop.position} (${Math.round(dist)} blocks away)`);
                    const result = await smartPathfinderGoto(
                        bot,
                        new GoalNear(crop.position.x, crop.position.y, crop.position.z, 3),
                        { timeoutMs: 10000 }  // Reduced from 15s to 10s
                    );
                    if (!result.success) {
                        console.log(`[BT] Failed to reach crop: ${result.failureReason}`);
                        continue;
                    }
                    bot.pathfinder.stop();
                }

                // Look at and harvest the crop
                await bot.lookAt(crop.position.offset(0.5, 0.5, 0.5), true);
                const currentBlock = bot.blockAt(crop.position);
                if (!currentBlock || !this.isMatureCrop(currentBlock)) continue;

                console.log(`[BT] Harvesting ${currentBlock.name} at ${crop.position}`);
                await bot.dig(currentBlock);
                harvestedAny = true;
                await sleep(100);

                // Immediately replant on the farmland below
                const farmlandPos = crop.position.offset(0, -1, 0);
                const farmland = bot.blockAt(farmlandPos);
                if (farmland?.name === 'farmland') {
                    await this.replant(bot, bb, farmland);
                }
            } catch {
                // Continue to next crop if this one fails
            }
        }

        return harvestedAny ? 'success' : 'failure';
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
