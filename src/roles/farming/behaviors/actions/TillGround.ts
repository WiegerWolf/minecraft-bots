import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { sleep } from './utils';

const { GoalNear } = goals;

export class TillGround implements BehaviorNode {
    name = 'TillGround';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canTill) return 'failure';
        if (!bb.farmCenter) return 'failure';

        // Find tillable block near water
        // IMPORTANT: In Minecraft, water ONLY hydrates farmland at the SAME Y level
        // Farmland at Y+1 above water will NOT be hydrated!
        // Only search at Y=0 (same level as water)
        let target: { position: Vec3 } | null = null;

        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                // Skip the water block itself
                if (x === 0 && z === 0) continue;

                const pos = bb.farmCenter.offset(x, 0, z);  // Y=0 only - same level as water
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

        if (!target) {
            console.log(`[BT] No tillable blocks found near farm center ${bb.farmCenter}`);
            return 'failure';
        }

        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return 'failure';

        console.log(`[BT] Tilling ground at ${target.position}`);
        bb.lastAction = 'till';

        try {
            // Check if we are already close enough to till
            if (bot.entity.position.distanceTo(target.position) > 4.5) {
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(target.position.x, target.position.y, target.position.z, 4),
                    { timeoutMs: 15000 }
                );
                if (!result.success) {
                    console.log(`[BT] Failed to reach till target: ${result.failureReason}`);
                    return 'failure';
                }
            } else {
                console.log(`[BT] Already within reach of ${target.position}, skipping movement`);
            }
            bot.pathfinder.stop();

            await bot.equip(hoe, 'hand');
            const block = bot.blockAt(target.position);
            if (block) {
                await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
                await bot.activateBlock(block);
                await sleep(200);

                // Verify tilling worked
                const afterBlock = bot.blockAt(target.position);
                if (afterBlock?.name === 'farmland') {
                    console.log(`[BT] Successfully created farmland at ${target.position}`);
                } else {
                    console.log(`[BT] Tilling may have failed - block is ${afterBlock?.name} not farmland`);
                }
            }
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
