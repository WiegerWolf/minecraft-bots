import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

// Track unreachable positions temporarily (cleared after 5 minutes)
const unreachableTillPositions = new Map<string, number>();
const UNREACHABLE_COOLDOWN_MS = 5 * 60 * 1000;

function posKey(pos: Vec3): string {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function isUnreachable(pos: Vec3): boolean {
    const key = posKey(pos);
    const markedTime = unreachableTillPositions.get(key);
    if (!markedTime) return false;
    if (Date.now() - markedTime > UNREACHABLE_COOLDOWN_MS) {
        unreachableTillPositions.delete(key);
        return false;
    }
    return true;
}

function markUnreachable(pos: Vec3): void {
    unreachableTillPositions.set(posKey(pos), Date.now());
}

export class TillGround implements BehaviorNode {
    name = 'TillGround';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canTill) return 'failure';
        if (!bb.farmCenter) return 'failure';

        // Find all tillable blocks near water
        // IMPORTANT: In Minecraft, water ONLY hydrates farmland at the SAME Y level
        // Farmland at Y+1 above water will NOT be hydrated!
        // Only search at Y=0 (same level as water)
        const candidates: Vec3[] = [];

        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                // Skip the water block itself
                if (x === 0 && z === 0) continue;

                const pos = bb.farmCenter.offset(x, 0, z);  // Y=0 only - same level as water

                // Skip positions marked as unreachable
                if (isUnreachable(pos)) continue;

                const block = bot.blockAt(pos);
                if (block && ['grass_block', 'dirt'].includes(block.name)) {
                    const above = bot.blockAt(pos.offset(0, 1, 0));
                    if (above && above.name === 'air') {
                        candidates.push(pos.clone());
                    }
                }
            }
        }

        if (candidates.length === 0) {
            bb.log?.debug({ farmCenter: bb.farmCenter?.toString() }, 'No tillable blocks found near farm center');
            return 'failure';
        }

        // Sort by distance to bot (closest first)
        const botPos = bot.entity.position;
        candidates.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return 'failure';

        bb.lastAction = 'till';

        // Try each candidate until one works
        for (const targetPos of candidates) {
            bb.log?.debug({ pos: targetPos.toString() }, 'Trying to till ground');

            try {
                // Check if we are already close enough to till
                if (bot.entity.position.distanceTo(targetPos) > 4.5) {
                    const result = await smartPathfinderGoto(
                        bot,
                        new GoalNear(targetPos.x, targetPos.y, targetPos.z, 4),
                        { timeoutMs: 15000 }
                    );
                    if (!result.success) {
                        bb.log?.debug({ pos: targetPos.toString(), reason: result.failureReason }, 'Cannot reach till target, trying next');
                        markUnreachable(targetPos);
                        continue;  // Try next candidate
                    }
                }
                bot.pathfinder.stop();

                await bot.equip(hoe, 'hand');
                const block = bot.blockAt(targetPos);
                if (block) {
                    await bot.lookAt(targetPos.offset(0.5, 1, 0.5), true);
                    await bot.activateBlock(block);
                    await sleep(200);

                    // Verify tilling worked
                    const afterBlock = bot.blockAt(targetPos);
                    if (afterBlock?.name === 'farmland') {
                        bb.log?.debug({ pos: targetPos.toString() }, 'Successfully created farmland');
                    } else {
                        bb.log?.debug({ pos: targetPos.toString(), blockName: afterBlock?.name }, 'Tilling may have failed');
                    }
                }
                return 'success';
            } catch (err) {
                bb.log?.debug({ pos: targetPos.toString(), err }, 'Error tilling, trying next');
                continue;
            }
        }

        // All candidates failed
        bb.log?.warn('Failed to till any candidate positions');
        return 'failure';
    }
}
