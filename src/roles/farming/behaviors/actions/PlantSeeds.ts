import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

export class PlantSeeds implements BehaviorNode {
    name = 'PlantSeeds';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canPlant) return 'failure';

        // Plant multiple farmland blocks in one go (up to 5)
        const farmlandToPlant = bb.nearbyFarmland.slice(0, 5);
        if (farmlandToPlant.length === 0) return 'failure';

        bb.lastAction = 'plant';
        let plantedAny = false;

        // Find available seeds
        const seedItem = bot.inventory.items().find(i =>
            i.name.includes('seeds') || ['carrot', 'potato'].includes(i.name)
        );
        if (!seedItem) return 'failure';

        // Equip seeds once
        await bot.equip(seedItem, 'hand');

        for (const farmland of farmlandToPlant) {
            try {
                // Get within 3 blocks (can place from this distance)
                const dist = bot.entity.position.distanceTo(farmland.position);
                if (dist > 4) {
                    const result = await smartPathfinderGoto(
                        bot,
                        new GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 3),
                        { timeoutMs: 15000 }
                    );
                    if (!result.success) continue;
                    bot.pathfinder.stop();
                }

                // Verify farmland still has air above
                const above = bot.blockAt(farmland.position.offset(0, 1, 0));
                if (!above || above.name !== 'air') continue;

                // Look at and plant
                await bot.lookAt(farmland.position.offset(0.5, 1, 0.5), true);
                bb.log?.debug(`[BT] Planting at ${farmland.position}`);
                await bot.placeBlock(farmland, new Vec3(0, 1, 0));
                plantedAny = true;
                await sleep(50);

                // Check if we still have seeds
                const stillHaveSeeds = bot.inventory.items().some(i =>
                    i.name.includes('seeds') || ['carrot', 'potato'].includes(i.name)
                );
                if (!stillHaveSeeds) break;
            } catch {
                // Continue to next farmland if this one fails
            }
        }

        return plantedAny ? 'success' : 'failure';
    }
}
