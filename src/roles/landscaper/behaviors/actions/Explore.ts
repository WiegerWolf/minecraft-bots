import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { recordExploredPosition, getExplorationScore } from '../../LandscaperBlackboard';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear } = goals;

/**
 * Explore - Wander around waiting for terraform requests
 */
export class Explore implements BehaviorNode {
    name = 'Explore';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        bb.lastAction = 'explore';

        // If we have a village center, stay near it
        const center = bb.villageCenter || bot.entity.position;
        const maxRadius = bb.villageCenter ? 60 : 40;

        // Generate exploration candidates
        const candidates: { pos: Vec3; score: number }[] = [];

        // Add random exploration points around center
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            const dist = 10 + Math.random() * 25;
            const pos = new Vec3(
                center.x + Math.cos(angle) * dist,
                center.y,
                center.z + Math.sin(angle) * dist
            );
            const score = getExplorationScore(bb, pos);
            candidates.push({ pos, score });
        }

        // Sort by score
        candidates.sort((a, b) => b.score - a.score);

        const target = candidates[0];
        if (!target || target.score < 20) {
            // All areas explored, wait
            bb.consecutiveIdleTicks++;
            if (bb.consecutiveIdleTicks > 10) {
                console.log(`[Landscaper] Waiting for terraform requests...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                bb.consecutiveIdleTicks = 0;
            }
            return 'failure';
        }

        bb.consecutiveIdleTicks = 0;

        console.log(`[Landscaper] Exploring to ${target.pos.floored()} (score: ${target.score})`);

        try {
            // Find safe Y level
            let targetY = target.pos.y;
            const searchStart = Math.max(target.pos.y, bot.entity.position.y);

            for (let y = searchStart; y >= searchStart - 20; y--) {
                const checkPos = new Vec3(target.pos.x, y, target.pos.z);
                const block = bot.blockAt(checkPos);
                const above = bot.blockAt(checkPos.offset(0, 1, 0));
                const below = bot.blockAt(checkPos.offset(0, -1, 0));

                if (below && below.boundingBox === 'block' &&
                    block && block.name === 'air' &&
                    above && (above.name === 'air' || above.name.includes('leaves'))) {
                    targetY = y;
                    break;
                }
            }

            await bot.pathfinder.goto(new GoalNear(target.pos.x, targetY, target.pos.z, 3));
            recordExploredPosition(bb, bot.entity.position);
            return 'success';
        } catch (error) {
            console.log(`[Landscaper] Explore path failed: ${error instanceof Error ? error.message : 'unknown'}`);
            recordExploredPosition(bb, target.pos, 'unreachable');
            return 'failure';
        }
    }
}
