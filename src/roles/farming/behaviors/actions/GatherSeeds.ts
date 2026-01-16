import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { sleep } from './utils';

const { GoalNear } = goals;

export class GatherSeeds implements BehaviorNode {
    name = 'GatherSeeds';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.needsSeeds) return 'failure';

        // If no grass in blackboard, try to find some directly
        let grass = bb.nearbyGrass[0];

        if (!grass) {
            // Try finding grass with expanded block names for different MC versions
            // Note: seagrass and tall_seagrass are excluded because they don't drop seeds
            const grassNames = [
                'short_grass', 'tall_grass', 'grass', 'fern', 'large_fern'
            ];

            const grassBlocks = bot.findBlocks({
                point: bot.entity.position,
                maxDistance: 32,
                count: 1,
                matching: b => {
                    if (!b || !b.name) return false;
                    return grassNames.includes(b.name);
                }
            });

            if (grassBlocks.length > 0) {
                const pos = grassBlocks[0];
                if (pos) {
                    grass = bot.blockAt(pos) ?? undefined;
                }
            }
        }

        if (!grass) {
            console.log(`[BT] No grass found nearby for seeds`);
            return 'failure';
        }

        console.log(`[BT] Breaking ${grass.name} for seeds at ${grass.position}`);
        bb.lastAction = 'gather_seeds';

        try {
            await bot.pathfinder.goto(new GoalNear(grass.position.x, grass.position.y, grass.position.z, 2));
            await bot.dig(grass);
            await sleep(300);
            return 'success';
        } catch (err) {
            console.log(`[BT] Failed to gather seeds: ${err}`);
            return 'failure';
        }
    }
}
