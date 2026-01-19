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

        // Explore in the next direction
        const pos = bot.entity.position;
        const direction = this.explorationDirections[this.explorationIndex % this.explorationDirections.length]!;
        this.explorationIndex++;

        // Calculate target position
        const targetPos = pos.plus(direction.scaled(EXPLORE_RADIUS));

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
