import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';
import { LOG_NAMES } from '../../../shared/TreeHarvest';

const { GoalNear, GoalXZ } = goals;

// Minimum trees in cluster to be considered a forest
const MIN_FOREST_SIZE = 3;
// Search radius when exploring for forests
const EXPLORE_RADIUS = 32;
// Maximum exploration attempts before giving up
const MAX_EXPLORE_ATTEMPTS = 8;
// Elevation thresholds for terrain filtering
const MAX_EXPLORATION_Y = 85;   // Don't explore above this (mountains)
const MIN_EXPLORATION_Y = 55;   // Don't explore below this (ravines/underground)
// Water check radius
const WATER_CHECK_RADIUS = 3;

/**
 * FindForest - Explore to find a forest area with 3+ trees
 *
 * This action explores in different directions looking for clusters of trees.
 * When a valid forest is found (3+ trees within 16 blocks), it marks the location
 * and sets hasKnownForest to true.
 *
 * Unlike PatrolForest which just wanders, this actively searches for forests
 * and validates that the area has enough trees to be considered a forest.
 */
export class FindForest implements BehaviorNode {
    name = 'FindForest';

    private explorationIndex = 0;
    private readonly explorationDirections: Vec3[] = [
        new Vec3(1, 0, 0),   // East
        new Vec3(-1, 0, 0),  // West
        new Vec3(0, 0, 1),   // South
        new Vec3(0, 0, -1),  // North
        new Vec3(1, 0, 1),   // Southeast
        new Vec3(-1, 0, 1),  // Southwest
        new Vec3(1, 0, -1),  // Northeast
        new Vec3(-1, 0, -1), // Northwest
    ];

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Already have a known forest
        if (bb.hasKnownForest || bb.knownForests.length > 0) {
            return 'success';
        }

        // Check if we currently have enough forest trees
        if (bb.forestTrees.length >= MIN_FOREST_SIZE) {
            // We found one! Mark the location
            const center = this.getClusterCenter(bb.forestTrees.map(t => t.position));
            if (center) {
                bb.knownForests.push(center);
                bb.hasKnownForest = true;
                bb.pendingForestSignWrite = true;
                bot.chat('Found a good forest area!');
                bb.log?.info({ pos: center.floored().toString(), treeCount: bb.forestTrees.length }, 'Discovered forest!');
                return 'success';
            }
        }

        bb.lastAction = 'find_forest';
        bb.log?.debug({ attempt: this.explorationIndex + 1 }, 'Exploring to find forest');

        // Explore in the next direction - find a valid target on land
        const pos = bot.entity.position;
        let targetPos: Vec3 | null = null;
        let attemptsThisRound = 0;
        const maxAttemptsPerRound = this.explorationDirections.length;

        // Try to find a good exploration direction (on land, not mountains)
        while (attemptsThisRound < maxAttemptsPerRound) {
            const direction = this.explorationDirections[this.explorationIndex % this.explorationDirections.length]!;
            this.explorationIndex++;
            attemptsThisRound++;

            // Calculate potential target position
            const potentialTarget = pos.plus(direction.scaled(EXPLORE_RADIUS));

            // Check terrain quality at this target
            const terrainScore = this.evaluateTerrain(bot, potentialTarget, bb);

            if (terrainScore > 0) {
                targetPos = potentialTarget;
                bb.log?.debug({
                    direction: `${direction.x},${direction.z}`,
                    score: terrainScore,
                    target: potentialTarget.floored().toString()
                }, 'Found valid exploration direction');
                break;
            } else {
                bb.log?.debug({
                    direction: `${direction.x},${direction.z}`,
                    score: terrainScore,
                    target: potentialTarget.floored().toString()
                }, 'Skipping bad terrain direction');
            }
        }

        // If no valid direction found, we're probably stuck (surrounded by water/mountains)
        if (!targetPos) {
            bb.log?.warn('All exploration directions lead to bad terrain (water/mountains)');
            this.explorationIndex = 0;
            return 'failure';
        }

        try {
            // Move toward the exploration target
            const goal = new GoalXZ(targetPos.x, targetPos.z);
            const success = await pathfinderGotoWithRetry(bot, goal, 3, 15000);

            if (!success) {
                bb.log?.debug({ target: targetPos.floored().toString() }, 'Could not reach exploration target');
                // Continue to next direction
                return this.explorationIndex >= MAX_EXPLORE_ATTEMPTS ? 'failure' : 'running';
            }

            // Give time for world to load and blackboard to update
            await sleep(500);

            // Check again after moving - blackboard should be updated
            if (bb.forestTrees.length >= MIN_FOREST_SIZE) {
                const center = this.getClusterCenter(bb.forestTrees.map(t => t.position));
                if (center) {
                    bb.knownForests.push(center);
                    bb.hasKnownForest = true;
                    bb.pendingForestSignWrite = true;
                    bot.chat('Found a forest!');
                    bb.log?.info({ pos: center.floored().toString(), treeCount: bb.forestTrees.length }, 'Discovered forest during exploration!');
                    return 'success';
                }
            }

            // Not enough trees here, keep looking
            if (this.explorationIndex >= MAX_EXPLORE_ATTEMPTS) {
                bb.log?.warn('Could not find a forest after maximum exploration attempts');
                this.explorationIndex = 0;
                return 'failure';
            }

            return 'running';
        } catch (err) {
            bb.log?.debug({ err }, 'Error during forest exploration');
            return this.explorationIndex >= MAX_EXPLORE_ATTEMPTS ? 'failure' : 'running';
        }
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
