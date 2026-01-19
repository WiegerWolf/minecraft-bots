import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import { recordExploredPosition, getExplorationScore } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';
import { LOG_NAMES } from '../../../shared/TreeHarvest';

const { GoalNear, GoalXZ } = goals;

// Minimum trees in cluster to be considered a forest
const MIN_FOREST_SIZE = 3;
// Base search radius when exploring for forests
const BASE_EXPLORE_RADIUS = 32;
// Radius expansion per attempt (explores further when nearby is exhausted)
const RADIUS_EXPANSION = 8;
// Maximum exploration radius
const MAX_EXPLORE_RADIUS = 80;
// Maximum exploration attempts before giving up this round
const MAX_EXPLORE_ATTEMPTS = 12;
// Minimum score to consider a direction worth exploring
const MIN_EXPLORATION_SCORE = 30;
// Elevation thresholds for terrain filtering
const MAX_EXPLORATION_Y = 85;   // Don't explore above this (mountains)
const MIN_EXPLORATION_Y = 55;   // Don't explore below this (ravines/underground)

/**
 * A scored exploration candidate with terrain and history scores.
 */
interface ExplorationCandidate {
    pos: Vec3;
    directionName: string;
    explorationScore: number;  // From getExplorationScore (100 base, minus penalties)
    terrainScore: number;      // From evaluateTerrain (positive = good terrain)
    totalScore: number;        // Combined weighted score
}

/**
 * FindForest - Explore to find a forest area with 3+ trees
 *
 * This action explores in different directions looking for clusters of trees.
 * When a valid forest is found (3+ trees within 16 blocks), it marks the location
 * and sets hasKnownForest to true.
 *
 * Unlike the naive approach of cycling through directions, this action:
 * 1. Scores all potential directions based on exploration history + terrain quality
 * 2. Prioritizes unexplored areas (using getExplorationScore)
 * 3. Records visited positions to avoid revisiting (using recordExploredPosition)
 * 4. Gradually expands search radius when nearby areas are exhausted
 */
export class FindForest implements BehaviorNode {
    name = 'FindForest';

    private attemptCount = 0;
    private readonly explorationDirections: Vec3[] = [
        new Vec3(1, 0, 0),   // East
        new Vec3(-1, 0, 0),  // West
        new Vec3(0, 0, 1),   // South
        new Vec3(0, 0, -1),  // North
        new Vec3(1, 0, 1).normalize(),   // Southeast (normalized for consistent distance)
        new Vec3(-1, 0, 1).normalize(),  // Southwest
        new Vec3(1, 0, -1).normalize(),  // Northeast
        new Vec3(-1, 0, -1).normalize(), // Northwest
    ];

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Already have a known forest
        if (bb.hasKnownForest || bb.knownForests.length > 0) {
            this.attemptCount = 0;
            return 'success';
        }

        // Check if we currently have enough forest trees
        if (bb.forestTrees.length >= MIN_FOREST_SIZE) {
            // We found one! Mark the location
            const center = this.getClusterCenter(bb.forestTrees.map(t => t.position));
            if (center) {
                bb.knownForests.push(center);
                bb.hasKnownForest = true;
                bb.pendingSignWrites.push({ type: 'FOREST', pos: center.clone() });
                bot.chat('Found a good forest area!');
                bb.log?.info({ pos: center.floored().toString(), treeCount: bb.forestTrees.length }, 'Discovered forest!');
                this.attemptCount = 0;
                return 'success';
            }
        }

        bb.lastAction = 'find_forest';
        this.attemptCount++;

        // Gradually expand search radius when nearby areas are exhausted
        const expansionFactor = Math.floor(this.attemptCount / 4);
        const currentRadius = Math.min(
            BASE_EXPLORE_RADIUS + expansionFactor * RADIUS_EXPANSION,
            MAX_EXPLORE_RADIUS
        );

        bb.log?.debug({
            attempt: this.attemptCount,
            radius: currentRadius
        }, 'Exploring to find forest');

        const pos = bot.entity.position;

        // Score ALL directions and pick the best one
        const candidates = this.scoreAllDirections(bot, bb, pos, currentRadius);

        if (candidates.length === 0) {
            bb.log?.warn('All exploration directions lead to bad terrain (water/mountains)');
            // Record current position as explored to avoid getting stuck
            recordExploredPosition(bb, pos, 'no_valid_directions');

            if (this.attemptCount >= MAX_EXPLORE_ATTEMPTS) {
                this.attemptCount = 0;
                return 'failure';
            }
            return 'running';
        }

        // Pick the best candidate (highest combined score)
        const target = candidates[0]!;

        bb.log?.debug({
            direction: target.directionName,
            explorationScore: target.explorationScore,
            terrainScore: target.terrainScore,
            totalScore: target.totalScore,
            target: target.pos.floored().toString(),
            radius: currentRadius
        }, 'Selected best exploration direction');

        try {
            // Move toward the exploration target
            const goal = new GoalXZ(target.pos.x, target.pos.z);
            const success = await pathfinderGotoWithRetry(bot, goal, 3, 20000);

            if (!success) {
                bb.log?.debug({ target: target.pos.floored().toString() }, 'Could not reach exploration target');
                // Record as explored even on failure to avoid retrying same spot
                recordExploredPosition(bb, target.pos, 'unreachable');

                if (this.attemptCount >= MAX_EXPLORE_ATTEMPTS) {
                    this.attemptCount = 0;
                    return 'failure';
                }
                return 'running';
            }

            // Successfully reached target - record it
            recordExploredPosition(bb, bot.entity.position, 'visited');

            // Give time for world to load and blackboard to update
            await sleep(500);

            // Check again after moving - blackboard should be updated
            if (bb.forestTrees.length >= MIN_FOREST_SIZE) {
                const center = this.getClusterCenter(bb.forestTrees.map(t => t.position));
                if (center) {
                    bb.knownForests.push(center);
                    bb.hasKnownForest = true;
                    bb.pendingSignWrites.push({ type: 'FOREST', pos: center.clone() });
                    bot.chat('Found a forest!');
                    bb.log?.info({ pos: center.floored().toString(), treeCount: bb.forestTrees.length }, 'Discovered forest during exploration!');
                    this.attemptCount = 0;
                    return 'success';
                }
            }

            // Not enough trees here, keep looking
            if (this.attemptCount >= MAX_EXPLORE_ATTEMPTS) {
                bb.log?.warn('Could not find a forest after maximum exploration attempts');
                this.attemptCount = 0;
                return 'failure';
            }

            return 'running';
        } catch (err) {
            bb.log?.debug({ err }, 'Error during forest exploration');
            recordExploredPosition(bb, target.pos, 'error');

            if (this.attemptCount >= MAX_EXPLORE_ATTEMPTS) {
                this.attemptCount = 0;
                return 'failure';
            }
            return 'running';
        }
    }

    /**
     * Score all exploration directions and return sorted candidates.
     * Combines exploration memory score (favoring unexplored) with terrain quality.
     */
    private scoreAllDirections(
        bot: Bot,
        bb: LumberjackBlackboard,
        pos: Vec3,
        radius: number
    ): ExplorationCandidate[] {
        const candidates: ExplorationCandidate[] = [];
        const directionNames = ['E', 'W', 'S', 'N', 'SE', 'SW', 'NE', 'NW'];

        for (let i = 0; i < this.explorationDirections.length; i++) {
            const direction = this.explorationDirections[i]!;
            const dirName = directionNames[i]!;
            const targetPos = pos.plus(direction.scaled(radius));

            // Get exploration score (100 base, minus penalties for nearby explored areas)
            const explorationScore = getExplorationScore(bb, targetPos);

            // Get terrain quality score
            const terrainScore = this.evaluateTerrain(bot, targetPos, bb);

            // Skip directions with bad terrain
            if (terrainScore <= 0) {
                bb.log?.trace?.({
                    direction: dirName,
                    terrainScore,
                    target: targetPos.floored().toString()
                }, 'Skipping bad terrain');
                continue;
            }

            // Combined score: heavily weight unexplored areas
            // Exploration score matters more - we want to go somewhere new
            const totalScore = explorationScore * 2 + terrainScore;

            // Only consider if score is above minimum threshold
            if (totalScore >= MIN_EXPLORATION_SCORE) {
                candidates.push({
                    pos: targetPos,
                    directionName: dirName,
                    explorationScore,
                    terrainScore,
                    totalScore
                });
            }
        }

        // Sort by total score descending (best first)
        candidates.sort((a, b) => b.totalScore - a.totalScore);

        return candidates;
    }

    /**
     * Evaluate terrain quality at a position.
     * Returns a score: positive = good to explore, 0 or negative = bad terrain.
     *
     * Checks:
     * - Is the position over water/ocean? (bad)
     * - Is the position at extreme elevation? (mountains = bad, ravines = bad)
     * - Is there solid ground to walk on? (good)
     */
    private evaluateTerrain(bot: Bot, targetPos: Vec3, bb: LumberjackBlackboard): number {
        let score = 100;

        // Check Y level - avoid mountains and ravines
        const targetY = Math.floor(targetPos.y);
        if (targetY > MAX_EXPLORATION_Y) {
            bb.log?.trace?.({ y: targetY, max: MAX_EXPLORATION_Y }, 'Position too high (mountain)');
            return -50; // Mountains - hard no
        }
        if (targetY < MIN_EXPLORATION_Y) {
            bb.log?.trace?.({ y: targetY, min: MIN_EXPLORATION_Y }, 'Position too low (ravine/underground)');
            return -50; // Underground/ravine - hard no
        }

        // Sample points along the path to check for water
        const currentPos = bot.entity.position;
        const direction = targetPos.minus(currentPos).normalize();
        const distance = currentPos.distanceTo(targetPos);

        // Check at intervals along the path
        const checkPoints = Math.min(5, Math.floor(distance / 8));
        let waterBlockCount = 0;
        let solidBlockCount = 0;

        for (let i = 1; i <= checkPoints; i++) {
            const checkPos = currentPos.plus(direction.scaled((distance / checkPoints) * i));
            const x = Math.floor(checkPos.x);
            const z = Math.floor(checkPos.z);

            // Find the surface at this XZ position
            const surfaceInfo = this.findSurface(bot, x, z, Math.floor(currentPos.y));

            if (surfaceInfo.isWater) {
                waterBlockCount++;
            } else if (surfaceInfo.isSolid) {
                solidBlockCount++;
            }
        }

        // Also check the target position itself
        const targetSurface = this.findSurface(bot, Math.floor(targetPos.x), Math.floor(targetPos.z), Math.floor(targetPos.y));
        if (targetSurface.isWater) {
            waterBlockCount += 2; // Weight target more heavily
        } else if (targetSurface.isSolid) {
            solidBlockCount += 2;
        }

        // Evaluate based on findings
        if (waterBlockCount > checkPoints / 2) {
            // More than half the path is water - this is ocean/lake
            bb.log?.trace?.({ waterCount: waterBlockCount, total: checkPoints }, 'Path goes over water');
            return -30;
        }

        if (solidBlockCount === 0) {
            // No solid ground found
            bb.log?.trace?.('No solid ground found along path');
            return -20;
        }

        // Bonus for more solid ground
        score += solidBlockCount * 5;

        // Penalty for any water
        score -= waterBlockCount * 10;

        return score;
    }

    /**
     * Find the surface block at an XZ position, searching from a starting Y.
     * Returns information about what's at the surface.
     */
    private findSurface(bot: Bot, x: number, z: number, startY: number): { isWater: boolean; isSolid: boolean; y: number } {
        // Search up and down from startY to find surface
        const searchRange = 15;

        // First search down
        for (let y = startY; y > startY - searchRange; y--) {
            const block = bot.blockAt(new Vec3(x, y, z));
            if (!block) continue;

            // Water
            if (block.name === 'water' || block.name === 'flowing_water') {
                return { isWater: true, isSolid: false, y };
            }

            // Solid ground
            if (!block.transparent && block.name !== 'air' && !block.name.includes('leaves')) {
                return { isWater: false, isSolid: true, y };
            }
        }

        // Then search up
        for (let y = startY + 1; y < startY + searchRange; y++) {
            const block = bot.blockAt(new Vec3(x, y, z));
            if (!block) continue;

            // Water
            if (block.name === 'water' || block.name === 'flowing_water') {
                return { isWater: true, isSolid: false, y };
            }

            // Solid ground
            if (!block.transparent && block.name !== 'air' && !block.name.includes('leaves')) {
                return { isWater: false, isSolid: true, y };
            }
        }

        // Couldn't determine - assume unloaded chunk
        return { isWater: false, isSolid: false, y: startY };
    }

    private getClusterCenter(positions: Vec3[]): Vec3 | null {
        if (positions.length === 0) return null;

        let sumX = 0, sumY = 0, sumZ = 0;
        for (const pos of positions) {
            sumX += pos.x;
            sumY += pos.y;
            sumZ += pos.z;
        }

        return new Vec3(
            Math.floor(sumX / positions.length),
            Math.floor(sumY / positions.length),
            Math.floor(sumZ / positions.length)
        );
    }
}
