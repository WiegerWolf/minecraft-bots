import type { Bot } from 'mineflayer';
import {
    type FarmingBlackboard,
    recordExploredPosition,
    getExplorationScore
} from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear } = goals;

interface ExplorationCandidate {
    pos: Vec3;
    score: number;
}

export class Explore implements BehaviorNode {
    name = 'Explore';
    private lastExploreTime = 0;

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Don't explore too frequently
        if (Date.now() - this.lastExploreTime < 5000) {
            return 'failure';
        }

        bb.consecutiveIdleTicks++;

        if (bb.consecutiveIdleTicks < 3) {
            return 'failure';
        }

        bb.lastAction = 'explore';
        this.lastExploreTime = Date.now();

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
            console.log(`[BT] No valid exploration targets found`);
            return 'failure';
        }

        // Sort by score (highest first) and pick the best
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        if (!best || best.score < -50) {
            console.log(`[BT] All exploration targets have poor scores, waiting...`);
            return 'failure';
        }

        console.log(`[BT] Exploring to ${best.pos.floored()} (score: ${best.score.toFixed(0)})`);

        try {
            await bot.pathfinder.goto(new GoalNear(best.pos.x, best.pos.y, best.pos.z, 3));

            // Record this position as explored
            recordExploredPosition(bb, bot.entity.position, 'visited');

            bb.consecutiveIdleTicks = 0;
            return 'success';
        } catch {
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
