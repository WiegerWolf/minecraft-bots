import type { Bot } from 'mineflayer';
import {
    type FarmingBlackboard,
    recordExploredPosition,
    getExplorationScore
} from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { GoalNear } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { hasClearSky, isYLevelSafe, NO_SKY_PENALTY, UNSAFE_Y_PENALTY } from '../../../../shared/TerrainUtils';

interface ExplorationCandidate {
    pos: Vec3;
    score: number;
}

// Cooldown between explorations in milliseconds
const EXPLORE_COOLDOWN_MS = 5000;

export class Explore implements BehaviorNode {
    name = 'Explore';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Don't explore too frequently - check blackboard cooldown
        // Note: The cooldown is checked both here (behavior) and in GOAP preconditions
        // The precondition prevents the planner from selecting Explore during cooldown
        // Return 'success' when on cooldown to indicate intentional waiting - NOT 'failure'
        // Returning 'failure' would trigger a goal cooldown, compounding the cooldown effect
        if (Date.now() < bb.exploreOnCooldownUntil) {
            return 'success';
        }

        // Note: Removed the consecutiveIdleTicks guard - it conflicted with GOAPRole
        // which resets idle ticks after every action execution (including failures).
        // GOAP already controls exploration priority via ExploreGoal utility functions.

        bb.lastAction = 'explore';

        // Generate candidate positions in a circle around the bot
        const currentPos = bot.entity.position;
        const candidates: ExplorationCandidate[] = [];
        const distances = [32, 48, 64, 80];  // Explore further to find water
        const directions = 12;  // More directions for better coverage

        // Sea level in Minecraft is around Y=62-64
        const SEA_LEVEL = 63;

        for (const dist of distances) {
            for (let i = 0; i < directions; i++) {
                const angle = (Math.PI * 2 * i) / directions;
                const tx = currentPos.x + Math.cos(angle) * dist;
                const tz = currentPos.z + Math.sin(angle) * dist;

                // Find surface block at this position
                const surfaceY = this.findSurfaceY(bot, tx, tz, currentPos.y);
                if (surfaceY === null) continue;

                const candidatePos = new Vec3(tx, surfaceY, tz);

                // Calculate score based on exploration history
                let score = getExplorationScore(bb, candidatePos);

                // Add small randomness to break ties
                score += Math.random() * 10;

                // CRITICAL: Strongly penalize positions without clear sky (caves!)
                // Farmers must stay above ground to find water and farmland
                if (!hasClearSky(bot, candidatePos, 0)) {
                    score += NO_SKY_PENALTY;  // Very heavy penalty for underground
                    bb.log?.trace?.({ pos: candidatePos.floored().toString() }, 'Penalizing exploration target - no clear sky (cave)');
                }

                // Penalize positions at unsafe Y levels (too deep or too high)
                if (!isYLevelSafe(surfaceY)) {
                    score += UNSAFE_Y_PENALTY;
                    bb.log?.trace?.({ y: surfaceY }, 'Penalizing exploration target - unsafe Y level');
                }

                // STRONGLY prefer lower elevations when looking for water
                // Water is most common near sea level
                if (!bb.farmCenter) {
                    const heightAboveSeaLevel = surfaceY - SEA_LEVEL;
                    if (heightAboveSeaLevel > 20) {
                        score -= heightAboveSeaLevel * 2;  // Heavy penalty for mountains
                    } else if (heightAboveSeaLevel < 10) {
                        score += 20;  // Bonus for being near sea level
                    }
                }

                // Prefer staying near farm center if we have one (for seed gathering)
                if (bb.farmCenter) {
                    const distToFarm = candidatePos.distanceTo(bb.farmCenter);
                    if (distToFarm > 64) {
                        score -= 20;  // Penalize going too far from farm
                    }
                }

                candidates.push({ pos: candidatePos, score });
            }
        }

        if (candidates.length === 0) {
            bb.log?.debug(`[BT] No valid exploration targets found, waiting...`);
            bb.exploreOnCooldownUntil = Date.now() + EXPLORE_COOLDOWN_MS;
            // Return 'success' to indicate intentional waiting - NOT 'failure'
            // Returning 'failure' would trigger goal cooldown on top of action cooldown
            return 'success';
        }

        // Sort by score (highest first) and pick the best
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        if (!best || best.score < -50) {
            bb.log?.debug(`[BT] All exploration targets have poor scores, waiting...`);
            bb.exploreOnCooldownUntil = Date.now() + EXPLORE_COOLDOWN_MS;
            // Return 'success' to indicate intentional waiting - NOT 'failure'
            // Returning 'failure' would trigger goal cooldown on top of action cooldown
            return 'success';
        }

        bb.log?.debug(`[BT] Exploring to ${best.pos.floored()} (score: ${best.score.toFixed(0)})`);

        const result = await smartPathfinderGoto(
            bot,
            new GoalNear(best.pos.x, best.pos.y, best.pos.z, 3),
            { timeoutMs: 30000 }  // Longer timeout for exploration
        );

        // Set cooldown for next exploration attempt
        bb.exploreOnCooldownUntil = Date.now() + EXPLORE_COOLDOWN_MS;

        if (result.success) {
            // Record this position as explored
            recordExploredPosition(bb, bot.entity.position, 'visited');
            bb.consecutiveIdleTicks = 0;
            return 'success';
        } else {
            // Even if pathfinding fails, record we tried this area
            recordExploredPosition(bb, best.pos, 'failed');
            return 'failure';
        }
    }

    /**
     * Find the surface Y level at a given X,Z position
     */
    private findSurfaceY(bot: Bot, x: number, z: number, referenceY: number): number | null {
        const startY = Math.min(Math.floor(referenceY) + 15, 319);
        const endY = Math.max(Math.floor(referenceY) - 25, -60);

        for (let y = startY; y >= endY; y--) {
            const block = bot.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)));
            if (!block) continue;

            // Skip air and non-solid blocks
            if (block.boundingBox !== 'block') continue;

            // Skip leaves (can fall through)
            if (block.name.includes('leaves')) continue;

            // Skip water - we don't want to explore into water
            if (block.name === 'water' || block.name === 'flowing_water') {
                return null;
            }

            // Found solid ground, return position above it
            return y + 1;
        }

        return null;
    }
}
