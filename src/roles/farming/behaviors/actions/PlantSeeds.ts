import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear } = goals;

/**
 * Get crop types adjacent to a farmland block (for crop rotation)
 */
function getAdjacentCropTypes(bot: Bot, farmlandPos: Vec3): Set<string> {
    const cropTypes = new Set<string>();
    const offsets = [
        new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];
    for (const offset of offsets) {
        const block = bot.blockAt(farmlandPos.offset(offset.x, 1, offset.z));
        if (block) {
            if (block.name === 'wheat') cropTypes.add('wheat_seeds');
            if (block.name === 'carrots') cropTypes.add('carrot');
            if (block.name === 'potatoes') cropTypes.add('potato');
            if (block.name === 'beetroots') cropTypes.add('beetroot_seeds');
        }
    }
    return cropTypes;
}

export class PlantSeeds implements BehaviorNode {
    name = 'PlantSeeds';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canPlant) return 'failure';

        const farmland = bb.nearbyFarmland[0];
        if (!farmland) return 'failure';

        // Use crop rotation: prefer seeds different from adjacent crops
        const adjacentCrops = getAdjacentCropTypes(bot, farmland.position);
        const seedTypes = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'];
        const inventory = bot.inventory.items();

        let seedItem = null;
        // First: try seed NOT matching adjacent crops
        for (const seedType of seedTypes) {
            if (!adjacentCrops.has(seedType)) {
                seedItem = inventory.find(i => i.name === seedType);
                if (seedItem) break;
            }
        }
        // Fallback: any available seed
        if (!seedItem) {
            seedItem = inventory.find(i =>
                i.name.includes('seeds') || ['carrot', 'potato'].includes(i.name)
            );
        }
        if (!seedItem) return 'failure';

        console.log(`[BT] Planting ${seedItem.name} at ${farmland.position}`);
        bb.lastAction = 'plant';

        try {
            await bot.pathfinder.goto(new GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 2));
            bot.pathfinder.stop();

            await bot.equip(seedItem, 'hand');
            await bot.lookAt(farmland.position.offset(0.5, 1, 0.5), true);
            await bot.placeBlock(farmland, new Vec3(0, 1, 0));
            await sleep(150);
            return 'success';
        } catch (err) {
            console.log(`[BT] Planting failed: ${err}`);
            return 'failure';
        }
    }
}
