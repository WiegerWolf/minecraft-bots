import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

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
            bb.log?.debug({ farmCenter: bb.farmCenter?.toString() }, 'No tillable blocks found near farm center');
            return 'failure';
        }

        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return 'failure';

        bb.log?.debug({ pos: target.position.toString() }, 'Tilling ground');
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
                    bb.log?.warn({ reason: result.failureReason }, 'Failed to reach till target');
                    return 'failure';
                }
            } else {
                bb.log?.debug({ pos: target.position.toString() }, 'Already within reach, skipping movement');
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
                    bb.log?.debug({ pos: target.position.toString() }, 'Successfully created farmland');
                } else {
                    bb.log?.warn({ pos: target.position.toString(), blockName: afterBlock?.name }, 'Tilling may have failed');
                }
            }
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
