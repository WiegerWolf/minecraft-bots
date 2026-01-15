import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear } = goals;

export class TillGround implements BehaviorNode {
    name = 'TillGround';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canTill) return 'failure';
        if (!bb.farmCenter) return 'failure';

        // Find tillable block near water
        let target: { position: Vec3 } | null = null;

        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                const pos = bb.farmCenter.offset(x, 0, z);
                const block = bot.blockAt(pos);
                if (block && ['grass_block', 'dirt'].includes(block.name)) {
                    const above = bot.blockAt(pos.offset(0, 1, 0));
                    if (above && above.name === 'air') {
                        target = { position: pos };
                        break;
                    }
                }
            }
            if (target) break;
        }

        if (!target) return 'failure';

        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return 'failure';

        console.log(`[BT] Tilling ground at ${target.position}`);
        bb.lastAction = 'till';

        try {
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
            bot.pathfinder.stop();

            await bot.equip(hoe, 'hand');
            const block = bot.blockAt(target.position);
            if (block) {
                await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
                await bot.activateBlock(block);
                await sleep(200);
            }
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
