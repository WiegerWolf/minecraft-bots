import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { recordExploredPosition, getExplorationScore } from '../../LumberjackBlackboard';
import { GoalNear } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { LOG_NAMES } from '../../../shared/TreeHarvest';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { shouldPreemptForTrade } from '../../../../shared/TradePreemption';

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

        // Add distance from bot to each candidate (for timeout scaling)
        const botPos = bot.entity.position;
        const candidatesWithDist = candidates.map(c => ({
            ...c,
            dist: botPos.xzDistanceTo(c.pos)
        }));

        // Sort by score (higher is better), but apply a small distance penalty
        // to avoid always choosing distant targets
        candidatesWithDist.sort((a, b) => {
            const aAdjusted = a.score - a.dist * 0.3; // Small distance penalty
            const bAdjusted = b.score - b.dist * 0.3;
            return bAdjusted - aAdjusted;
        });

        // Filter to candidates with decent scores
        const viableCandidates = candidatesWithDist.filter(c => c.score >= 20);

        if (viableCandidates.length === 0) {
            // All areas well-explored, wait
            // Return 'success' to indicate intentional waiting - NOT 'failure'
            // Returning 'failure' would trigger a goal cooldown, leaving the bot
            // cycling between limited goal options.
            bb.consecutiveIdleTicks++;
            if (bb.consecutiveIdleTicks > 10) {
                bb.log?.debug(`[Lumberjack] Waiting for trees to grow...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                bb.consecutiveIdleTicks = 0;
            }
            return 'success';
        }

        bb.consecutiveIdleTicks = 0;

        // Try up to 3 candidates before giving up
        for (let i = 0; i < Math.min(3, viableCandidates.length); i++) {
            // Check for preemption before each patrol attempt
            if (shouldPreemptForTrade(bb, 'lumberjack')) {
                bb.log?.debug('PatrolForest preempted for trade');
                return 'failure';
            }

            const target = viableCandidates[i]!;
            bb.log?.debug(`[Lumberjack] Patrolling to ${target.pos.floored()} (score: ${target.score}, dist: ${target.dist.toFixed(0)})`);

            try {
                // Find a safe Y level - search from target Y downward to find ground
                // This handles cases where bot is on tree canopy and needs to get down
                let targetY = target.pos.y;
                const searchStart = Math.max(target.pos.y, botPos.y);

                // Search downward from higher of target/bot position to find walkable ground
                for (let y = searchStart; y >= searchStart - 20; y--) {
                    const checkPos = new Vec3(target.pos.x, y, target.pos.z);
                    const block = bot.blockAt(checkPos);
                    const above = bot.blockAt(checkPos.offset(0, 1, 0));
                    const below = bot.blockAt(checkPos.offset(0, -1, 0));

                    // Need: solid ground below, air at feet and head level
                    if (below && below.boundingBox === 'block' &&
                        block && block.name === 'air' &&
                        above && (above.name === 'air' || above.name.includes('leaves'))) {
                        targetY = y;
                        break;
                    }
                }

                // Scale timeout with distance: 10s base + 0.4s per block, max 30s
                const timeout = Math.min(30000, 10000 + target.dist * 400);

                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(target.pos.x, targetY, target.pos.z, 3),
                    { timeoutMs: timeout }
                );

                if (result.success) {
                    recordExploredPosition(bb, bot.entity.position);

                    // Check for preemption after pathfinding completes
                    if (shouldPreemptForTrade(bb, 'lumberjack')) {
                        bb.log?.debug('PatrolForest preempted for trade after pathfinding');
                        return 'failure';
                    }

                    return 'success';
                } else {
                    // Path failed, record as explored and try next candidate
                    bb.log?.debug(`[Lumberjack] Patrol path failed: ${result.failureReason}`);
                    recordExploredPosition(bb, target.pos, 'unreachable');
                    continue;
                }
            } catch (error) {
                // Unexpected error, try next candidate
                bb.log?.debug(`[Lumberjack] Patrol error: ${error instanceof Error ? error.message : 'unknown'}`);
                recordExploredPosition(bb, target.pos, 'unreachable');
                continue;
            }
        }

        // All candidates failed
        return 'failure';
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
        bb.log?.debug(`[Lumberjack] Waiting for village center to be established...`);

        // Wander randomly while waiting
        const angle = Math.random() * Math.PI * 2;
        const dist = 5 + Math.random() * 10;
        const target = new Vec3(
            bot.entity.position.x + Math.cos(angle) * dist,
            bot.entity.position.y,
            bot.entity.position.z + Math.sin(angle) * dist
        );

        await smartPathfinderGoto(
            bot,
            new GoalNear(target.x, target.y, target.z, 2),
            { timeoutMs: 15000 }
        );
        // Ignore path errors

        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'success';
    }
}
