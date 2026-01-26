import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { recordExploredPosition, getExplorationScore } from '../../LandscaperBlackboard';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { hasClearSky, isYLevelSafe, NO_SKY_PENALTY, UNSAFE_Y_PENALTY } from '../../../../shared/TerrainUtils';

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
            const basePos = new Vec3(
                center.x + Math.cos(angle) * dist,
                center.y,
                center.z + Math.sin(angle) * dist
            );

            // Find actual surface Y at this position
            let surfaceY = basePos.y;
            const searchStart = Math.max(basePos.y, bot.entity.position.y);
            for (let y = searchStart; y >= searchStart - 20; y--) {
                const checkPos = new Vec3(basePos.x, y, basePos.z);
                const block = bot.blockAt(checkPos);
                const below = bot.blockAt(checkPos.offset(0, -1, 0));
                if (below && below.boundingBox === 'block' && block && block.name === 'air') {
                    surfaceY = y;
                    break;
                }
            }

            const pos = new Vec3(basePos.x, surfaceY, basePos.z);
            let score = getExplorationScore(bb, pos);

            // CRITICAL: Strongly penalize positions without clear sky (caves!)
            // Landscapers must stay above ground to terraform effectively
            if (!hasClearSky(bot, pos, 0)) {
                score += NO_SKY_PENALTY;  // Very heavy penalty for underground
                bb.log?.trace?.({ pos: pos.floored().toString() }, 'Penalizing exploration target - no clear sky (cave)');
            }

            // Penalize positions at unsafe Y levels (too deep or too high)
            if (!isYLevelSafe(surfaceY)) {
                score += UNSAFE_Y_PENALTY;
                bb.log?.trace?.({ y: surfaceY }, 'Penalizing exploration target - unsafe Y level');
            }

            candidates.push({ pos, score });
        }

        // Sort by score
        candidates.sort((a, b) => b.score - a.score);

        const target = candidates[0];
        if (!target || target.score < 20) {
            // All areas explored or all candidates have low scores (underground/unsafe)
            // Return 'success' to indicate intentional waiting - NOT 'failure'
            // Returning 'failure' would trigger a goal cooldown, leaving the bot
            // with no valid goals when Explore is the only available goal.
            bb.consecutiveIdleTicks++;
            if (bb.consecutiveIdleTicks > 10) {
                bb.log?.debug(`[Landscaper] Waiting for terraform requests...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                bb.consecutiveIdleTicks = 0;
            }
            return 'success';
        }

        bb.consecutiveIdleTicks = 0;

        bb.log?.debug(`[Landscaper] Exploring to ${target.pos.floored()} (score: ${target.score})`);

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

            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(target.pos.x, targetY, target.pos.z, 3),
                { timeoutMs: 30000 }  // Longer timeout for exploration
            );
            if (result.success) {
                recordExploredPosition(bb, bot.entity.position);
                return 'success';
            } else {
                bb.log?.debug(`[Landscaper] Explore path failed: ${result.failureReason}`);
                recordExploredPosition(bb, target.pos, 'unreachable');
                return 'failure';
            }
        } catch (error) {
            bb.log?.debug(`[Landscaper] Explore error: ${error instanceof Error ? error.message : 'unknown'}`);
            recordExploredPosition(bb, target.pos, 'unreachable');
            return 'failure';
        }
    }
}
