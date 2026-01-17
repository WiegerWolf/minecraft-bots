import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { recordExploredPosition, getExplorationScore } from '../../LumberjackBlackboard';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { LOG_NAMES } from '../../../shared/TreeHarvest';

const { GoalNear } = goals;

/**
 * PatrolForest - Explore for more trees within village radius
 */
export class PatrolForest implements BehaviorNode {
    name = 'PatrolForest';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        bb.lastAction = 'patrol_forest';

        // If we have a village center, patrol around it
        const center = bb.villageCenter || bot.entity.position;
        const maxRadius = bb.villageCenter ? 80 : 64; // ~5 chunks

        // Look for trees in unexplored directions
        const logs = bot.findBlocks({
            point: center,
            maxDistance: maxRadius,
            count: 20,
            matching: b => {
                if (!b || !b.name) return false;
                return LOG_NAMES.includes(b.name);
            }
        });

        // Score potential exploration targets
        const candidates: { pos: Vec3; score: number }[] = [];

        // Add log positions as high-value targets
        for (const logPos of logs) {
            const score = getExplorationScore(bb, logPos) + 50; // Bonus for having trees
            candidates.push({ pos: logPos, score });
        }

        // Add random exploration points around the center
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            const dist = 20 + Math.random() * 30;
            const pos = new Vec3(
                center.x + Math.cos(angle) * dist,
                center.y,
                center.z + Math.sin(angle) * dist
            );
            const score = getExplorationScore(bb, pos);
            candidates.push({ pos, score });
        }

        // Sort by score (higher is better)
        candidates.sort((a, b) => b.score - a.score);

        // Try the best candidate
        const target = candidates[0];
        if (!target || target.score < 20) {
            // All areas well-explored, wait
            bb.consecutiveIdleTicks++;
            if (bb.consecutiveIdleTicks > 10) {
                console.log(`[Lumberjack] Waiting for trees to grow...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                bb.consecutiveIdleTicks = 0;
            }
            return 'failure';
        }

        bb.consecutiveIdleTicks = 0;

        // Move to target
        console.log(`[Lumberjack] Patrolling to ${target.pos.floored()} (score: ${target.score})`);

        try {
            // Find a safe Y level
            let targetY = target.pos.y;
            for (let dy = -3; dy <= 10; dy++) {
                const checkPos = new Vec3(target.pos.x, center.y + dy, target.pos.z);
                const block = bot.blockAt(checkPos);
                const above = bot.blockAt(checkPos.offset(0, 1, 0));
                if (block && !block.boundingBox && above && !above.boundingBox) {
                    targetY = checkPos.y;
                    break;
                }
            }

            await bot.pathfinder.goto(new GoalNear(target.pos.x, targetY, target.pos.z, 3));
            recordExploredPosition(bb, bot.entity.position);
            return 'success';
        } catch (error) {
            // Path failed, record as explored anyway
            recordExploredPosition(bb, target.pos, 'unreachable');
            return 'failure';
        }
    }
}

/**
 * WaitForVillage - Wait for village center to be established
 */
export class WaitForVillage implements BehaviorNode {
    name = 'WaitForVillage';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        if (bb.villageCenter) return 'failure'; // Have village, don't wait

        bb.lastAction = 'wait_for_village';
        console.log(`[Lumberjack] Waiting for village center to be established...`);

        // Wander randomly while waiting
        const angle = Math.random() * Math.PI * 2;
        const dist = 5 + Math.random() * 10;
        const target = new Vec3(
            bot.entity.position.x + Math.cos(angle) * dist,
            bot.entity.position.y,
            bot.entity.position.z + Math.sin(angle) * dist
        );

        try {
            await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 2));
        } catch {
            // Ignore path errors
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'success';
    }
}
