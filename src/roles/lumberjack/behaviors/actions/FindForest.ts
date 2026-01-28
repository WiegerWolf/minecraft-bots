import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';

// Extend Bot type to include vehicle property (exists at runtime)
interface BotWithVehicle extends Bot {
    vehicle: Entity | null;
}
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import { recordExploredPosition, getExplorationScore } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { GoalNear, GoalXZ } from 'baritone-ts';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';
import { LOG_NAMES } from '../../../shared/TreeHarvest';
import {
    placeBoatOnWater,
    findNearbyWaterBlock,
    navigateBoatToward,
    dismountAndBreakBoat,
    type BoatNavigationResult,
} from '../../../../shared/BoatUtils';
import { hasClearSky } from '../../../../shared/TerrainUtils';

// Minimum water distance to warrant using a boat (shorter distances can be swam)
const MIN_BOAT_DISTANCE = 8;

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
 * Result from terrain evaluation including water crossing info.
 */
interface TerrainEvalResult {
    score: number;              // Terrain quality score
    requiresBoat: boolean;      // True if path has significant water requiring boat
    waterStartPos: Vec3 | null; // Position where water begins (for boat placement)
}

/**
 * A scored exploration candidate with terrain and history scores.
 */
interface ExplorationCandidate {
    pos: Vec3;
    directionName: string;
    explorationScore: number;   // From getExplorationScore (100 base, minus penalties)
    terrainScore: number;       // From evaluateTerrain (positive = good terrain)
    totalScore: number;         // Combined weighted score
    requiresBoat?: boolean;     // True if path requires boat crossing
    waterStartPos?: Vec3 | null; // Where to place the boat
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
                // Set backoff: 60 seconds before trying again
                const FOREST_SEARCH_BACKOFF_MS = 60000;
                bb.forestSearchFailedUntil = Date.now() + FOREST_SEARCH_BACKOFF_MS;
                bb.log?.warn(`Could not find a forest after ${MAX_EXPLORE_ATTEMPTS} attempts, backing off for ${FOREST_SEARCH_BACKOFF_MS / 1000}s`);
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
            radius: currentRadius,
            requiresBoat: target.requiresBoat
        }, 'Selected best exploration direction');

        try {
            let success = false;

            if (target.requiresBoat && bb.hasBoat && target.waterStartPos) {
                // Use boat to cross water
                bb.log?.info({ waterStart: target.waterStartPos.floored().toString() }, 'Using boat to cross water');
                success = await this.useBoatToCross(bot, bb, target.waterStartPos, target.pos);
            } else {
                // Move toward the exploration target via land
                const goal = new GoalXZ(target.pos.x, target.pos.z);
                success = await pathfinderGotoWithRetry(bot, goal, 3, 20000);

                // Fallback: if land pathfinding failed and we have a boat, try crossing water
                if (!success && bb.hasBoat) {
                    const waterBlock = findNearbyWaterBlock(bot);
                    if (waterBlock) {
                        bb.log?.info({ waterPos: waterBlock.position.floored().toString() },
                            'Land pathfinding failed, retrying with boat');
                        // Find a position near the water to start from
                        const waterStartPos = new Vec3(
                            Math.floor(bot.entity.position.x),
                            waterBlock.position.y,
                            Math.floor(bot.entity.position.z)
                        );
                        success = await this.useBoatToCross(bot, bb, waterStartPos, target.pos);
                    }
                }
            }

            if (!success) {
                bb.log?.debug({ target: target.pos.floored().toString() }, 'Could not reach exploration target');
                // Record as explored even on failure to avoid retrying same spot
                recordExploredPosition(bb, target.pos, 'unreachable');

                if (this.attemptCount >= MAX_EXPLORE_ATTEMPTS) {
                    // Set backoff: 60 seconds before trying again
                    const FOREST_SEARCH_BACKOFF_MS = 60000;
                    bb.forestSearchFailedUntil = Date.now() + FOREST_SEARCH_BACKOFF_MS;
                    bb.log?.warn(`Could not find a forest after ${MAX_EXPLORE_ATTEMPTS} attempts, backing off for ${FOREST_SEARCH_BACKOFF_MS / 1000}s`);
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
                // Set backoff: 60 seconds before trying again
                const FOREST_SEARCH_BACKOFF_MS = 60000;
                bb.forestSearchFailedUntil = Date.now() + FOREST_SEARCH_BACKOFF_MS;
                bb.log?.warn(`Could not find a forest after ${MAX_EXPLORE_ATTEMPTS} attempts, backing off for ${FOREST_SEARCH_BACKOFF_MS / 1000}s`);
                this.attemptCount = 0;
                return 'failure';
            }

            return 'running';
        } catch (err) {
            bb.log?.debug({ err }, 'Error during forest exploration');
            recordExploredPosition(bb, target.pos, 'error');

            if (this.attemptCount >= MAX_EXPLORE_ATTEMPTS) {
                // Set backoff: 60 seconds before trying again
                const FOREST_SEARCH_BACKOFF_MS = 60000;
                bb.forestSearchFailedUntil = Date.now() + FOREST_SEARCH_BACKOFF_MS;
                bb.log?.warn(`Could not find a forest after ${MAX_EXPLORE_ATTEMPTS} attempts (error), backing off for ${FOREST_SEARCH_BACKOFF_MS / 1000}s`);
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

            // Get terrain quality score (pass hasBoat so water isn't penalized if we can boat across)
            const terrainResult = this.evaluateTerrain(bot, targetPos, bb, bb.hasBoat);

            // Skip directions with bad terrain
            if (terrainResult.score <= 0) {
                bb.log?.trace?.({
                    direction: dirName,
                    terrainScore: terrainResult.score,
                    target: targetPos.floored().toString()
                }, 'Skipping bad terrain');
                continue;
            }

            // Combined score: heavily weight unexplored areas
            // Exploration score matters more - we want to go somewhere new
            const totalScore = explorationScore * 2 + terrainResult.score;

            // Only consider if score is above minimum threshold
            if (totalScore >= MIN_EXPLORATION_SCORE) {
                candidates.push({
                    pos: targetPos,
                    directionName: dirName,
                    explorationScore,
                    terrainScore: terrainResult.score,
                    totalScore,
                    requiresBoat: terrainResult.requiresBoat,
                    waterStartPos: terrainResult.waterStartPos,
                });
            }
        }

        // Sort by total score descending (best first)
        candidates.sort((a, b) => b.totalScore - a.totalScore);

        return candidates;
    }

    /**
     * Evaluate terrain quality at a position.
     * Returns a result with score and boat requirements.
     *
     * Checks:
     * - Is the position over water/ocean? (bad without boat, ok with boat)
     * - Is the position at extreme elevation? (mountains = bad, ravines = bad)
     * - Is there solid ground to walk on? (good)
     *
     * @param bot - The bot instance
     * @param targetPos - Position to evaluate
     * @param bb - Blackboard for logging
     * @param hasBoat - Whether the bot has a boat available
     */
    private evaluateTerrain(bot: Bot, targetPos: Vec3, bb: LumberjackBlackboard, hasBoat: boolean): TerrainEvalResult {
        let score = 100;
        let requiresBoat = false;
        let waterStartPos: Vec3 | null = null;

        // Check Y level - avoid mountains and ravines
        const targetY = Math.floor(targetPos.y);
        if (targetY > MAX_EXPLORATION_Y) {
            bb.log?.trace?.({ y: targetY, max: MAX_EXPLORATION_Y }, 'Position too high (mountain)');
            return { score: -50, requiresBoat: false, waterStartPos: null }; // Mountains - hard no
        }
        if (targetY < MIN_EXPLORATION_Y) {
            bb.log?.trace?.({ y: targetY, min: MIN_EXPLORATION_Y }, 'Position too low (ravine/underground)');
            return { score: -50, requiresBoat: false, waterStartPos: null }; // Underground/ravine - hard no
        }

        // CRITICAL: Check for clear sky at target position (avoid caves!)
        // Lumberjacks must stay above ground to find forests
        if (!hasClearSky(bot, targetPos, 0)) {
            bb.log?.trace?.({ pos: targetPos.floored().toString() }, 'Position has no clear sky (cave)');
            return { score: -100, requiresBoat: false, waterStartPos: null }; // Cave - hard no
        }

        // Sample points along the path to check for water
        const currentPos = bot.entity.position;
        const direction = targetPos.minus(currentPos).normalize();
        const distance = currentPos.distanceTo(targetPos);

        // Check at intervals along the path
        const checkPoints = Math.min(5, Math.floor(distance / 8));
        let waterBlockCount = 0;
        let solidBlockCount = 0;
        let firstWaterPos: Vec3 | null = null;
        let consecutiveWaterBlocks = 0;
        let maxConsecutiveWater = 0;

        for (let i = 1; i <= checkPoints; i++) {
            const checkPos = currentPos.plus(direction.scaled((distance / checkPoints) * i));
            const x = Math.floor(checkPos.x);
            const z = Math.floor(checkPos.z);

            // Find the surface at this XZ position
            const surfaceInfo = this.findSurface(bot, x, z, Math.floor(currentPos.y));

            if (surfaceInfo.isWater) {
                waterBlockCount++;
                consecutiveWaterBlocks++;
                if (consecutiveWaterBlocks > maxConsecutiveWater) {
                    maxConsecutiveWater = consecutiveWaterBlocks;
                }
                // Track first water position for boat placement
                if (!firstWaterPos) {
                    // Find position just before water for boat placement
                    const beforeWaterDist = ((distance / checkPoints) * (i - 1)) + 2;
                    const beforeWater = currentPos.plus(direction.scaled(beforeWaterDist));
                    firstWaterPos = new Vec3(
                        Math.floor(beforeWater.x),
                        surfaceInfo.y,
                        Math.floor(beforeWater.z)
                    );
                }
            } else {
                consecutiveWaterBlocks = 0;
                if (surfaceInfo.isSolid) {
                    solidBlockCount++;
                }
            }
        }

        // Track path solid count before checking target (for boat path analysis)
        const pathSolidCount = solidBlockCount;

        // Also check the target position itself
        const targetSurface = this.findSurface(bot, Math.floor(targetPos.x), Math.floor(targetPos.z), Math.floor(targetPos.y));
        let targetHasNoTerrain = false;
        if (targetSurface.isWater) {
            waterBlockCount += 2; // Weight target more heavily
        } else if (targetSurface.isSolid) {
            solidBlockCount += 2;
        } else {
            // Target has no solid ground and no water - likely unloaded/empty chunk
            targetHasNoTerrain = true;
        }

        // Evaluate based on findings
        const waterRatio = waterBlockCount / (checkPoints + 2);
        // More aggressive water detection: ANY water OR consecutive water blocks should trigger boat
        // Previously used `waterBlockCount > checkPoints / 2` which missed paths with sparse water
        const hasWaterBarrier = waterBlockCount >= 1 || maxConsecutiveWater >= 1;

        if (hasWaterBarrier) {
            // Path has water that could block pathfinding
            if (hasBoat) {
                // With a boat, water paths should be competitive with land paths
                // Boat travel is actually faster than walking, so give good score
                bb.log?.debug?.({ waterCount: waterBlockCount, consecutive: maxConsecutiveWater, total: checkPoints }, 'Path has water - will use boat');
                requiresBoat = true;
                waterStartPos = firstWaterPos;
                // Base score of 110 (competitive with land paths ~115-130)
                // Small penalty for more water (longer boat ride)
                score = 110 - waterRatio * 10;
            } else {
                // Without a boat, penalize heavily but don't completely reject
                // (pathfinder might find a way around small water patches)
                bb.log?.trace?.({ waterCount: waterBlockCount, total: checkPoints }, 'Path has water - no boat available');
                if (waterBlockCount > checkPoints / 2) {
                    // Too much water to cross without boat
                    return { score: -30, requiresBoat: false, waterStartPos: null };
                }
                // Some water but maybe pathable - reduce score
                score -= waterBlockCount * 15;
            }
        } else {
            // Mostly land path
            if (solidBlockCount === 0) {
                // No solid ground found
                bb.log?.trace?.('No solid ground found along path');
                return { score: -20, requiresBoat: false, waterStartPos: null };
            }

            // Bonus for more solid ground
            score += solidBlockCount * 5;
        }

        // Apply penalties for bad destinations (after base score calculation)
        if (targetHasNoTerrain) {
            // Target has no solid ground and no water - likely unloaded/empty chunk
            bb.log?.info?.({ target: targetPos.floored().toString(), scoreBefore: score }, 'Target has no terrain - penalizing');
            score -= 30;
        }

        // For boat paths, check path quality
        // Penalize paths that cross significant water to reach random generated terrain
        if (requiresBoat) {
            if (pathSolidCount === 0) {
                // Boat path with no solid ground along the way - probably leads to nowhere useful
                bb.log?.info?.({ target: targetPos.floored().toString(), pathSolidCount, scoreBefore: score }, 'Boat path has no solid ground along route - penalizing');
                score -= 20;
            } else if (maxConsecutiveWater >= 2 && targetSurface.isSolid && pathSolidCount <= 1) {
                // Crossed water barrier to reach solid ground - probably just random generated terrain
                // Not a meaningful exploration destination
                bb.log?.info?.({ target: targetPos.floored().toString(), maxConsecutiveWater, pathSolidCount, scoreBefore: score }, 'Boat path crosses water to random terrain - penalizing');
                score -= 25;
            }
        }

        return { score, requiresBoat, waterStartPos };
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

    /**
     * Use a boat to cross a body of water.
     *
     * Steps:
     * 1. Walk to the water's edge
     * 2. Place the boat on the water
     * 3. Mount the boat
     * 4. Navigate across the water toward destination
     * 5. Dismount when near land
     *
     * @param bot - The bot instance
     * @param bb - Blackboard
     * @param waterStartPos - Position near the water's edge
     * @param destination - Final destination on the other side
     * @returns true if successfully crossed, false otherwise
     */
    private async useBoatToCross(
        bot: Bot,
        bb: LumberjackBlackboard,
        waterStartPos: Vec3,
        destination: Vec3
    ): Promise<boolean> {
        const log = bb.log ? {
            debug: (msg: any, ...args: any[]) => bb.log?.debug(msg, ...args),
            warn: (msg: any, ...args: any[]) => bb.log?.warn(msg, ...args),
            info: (msg: any, ...args: any[]) => bb.log?.info(msg, ...args),
        } : undefined;

        try {
            // Step 1: Walk to water's edge - need to be within 1 block to place boat
            bb.log?.debug({ pos: waterStartPos.floored().toString() }, 'Walking to water edge');
            const walkGoal = new GoalNear(waterStartPos.x, waterStartPos.y, waterStartPos.z, 1);
            const walkSuccess = await pathfinderGotoWithRetry(bot, walkGoal, 2, 15000);
            if (!walkSuccess) {
                bb.log?.warn('Could not reach water edge');
                return false;
            }
            bb.log?.debug({ botPos: bot.entity.position.floored().toString() }, 'Reached water edge');

            // Step 2: Check for boat in inventory
            const boatItem = bot.inventory.items().find(i => i.name.includes('boat'));
            if (!boatItem) {
                bb.log?.warn('No boat in inventory');
                return false;
            }

            // Step 3: Find water and place boat using the fixed packet method
            const waterBlock = findNearbyWaterBlock(bot);
            if (!waterBlock) {
                bb.log?.warn('No water nearby to place boat');
                return false;
            }

            bb.log?.debug({ water: waterBlock.position.floored().toString() }, 'Placing boat on water');

            // Use the fixed boat placement that works in MC 1.21+
            const boatLog = bb.log ? {
                debug: (msg: any, ...args: any[]) => bb.log?.debug(msg, ...args),
                warn: (msg: any, ...args: any[]) => bb.log?.warn(msg, ...args),
            } : undefined;
            const boatEntity = await placeBoatOnWater(bot, waterBlock, 5000, boatLog);
            if (!boatEntity) {
                bb.log?.warn('Could not place boat on water');
                return false;
            }

            // Step 4: Mount the boat
            bb.log?.debug({ boatId: boatEntity.id }, 'Mounting boat');
            try {
                await bot.mount(boatEntity);
                await sleep(300);
            } catch (err) {
                bb.log?.warn({ err }, 'Failed to mount boat');
                return false;
            }

            // Verify we're mounted
            const botWithVehicle = bot as BotWithVehicle;
            if (!botWithVehicle.vehicle) {
                bb.log?.warn('Failed to mount boat');
                return false;
            }

            bb.log?.info('Successfully mounted boat, navigating across water');

            // Step 5: Navigate across water toward destination
            const navResult = await navigateBoatToward(bot, destination, 30000, log);

            // Step 6: Dismount and try to recover the boat
            // Pass last known position from navigation for proper dismount packet
            await dismountAndBreakBoat(bot, navResult.lastPos, navResult.lastYawDeg, log);
            bb.log?.debug({ reason: navResult.reason }, 'Dismounted from boat');

            // Step 7: Continue to destination based on navigation result
            const distToTarget = navResult.distanceRemaining;
            if (distToTarget > 10) {
                if (navResult.reason === 'land_collision') {
                    // Hit land - walk across it, may need boat again for more water
                    bb.log?.info({ dist: distToTarget.toFixed(1) }, 'Hit land while boating, continuing on foot');
                } else if (navResult.reason === 'no_progress') {
                    // Paper server - boat controls don't work, swim instead
                    bb.log?.info({ dist: distToTarget.toFixed(1) }, 'Boat navigation failed (Paper server?), swimming to destination');
                } else {
                    bb.log?.debug({ dist: distToTarget.toFixed(1) }, 'Continuing to destination on foot');
                }
                const finalGoal = new GoalXZ(destination.x, destination.z);
                // Give more time for swimming/walking (it's slower)
                const continueSuccess = await pathfinderGotoWithRetry(bot, finalGoal, 2, 45000);
                return continueSuccess;
            }

            return navResult.success; // Close enough to destination
        } catch (err) {
            bb.log?.error({ err }, 'Error during boat crossing');
            // Make sure we dismount if something goes wrong
            // No position info available, will use fallback
            await dismountAndBreakBoat(bot, undefined, undefined, log);
            return false;
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
