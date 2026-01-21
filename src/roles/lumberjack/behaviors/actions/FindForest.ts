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
import { goals } from 'mineflayer-pathfinder';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';
import { LOG_NAMES } from '../../../shared/TreeHarvest';

// Minimum water distance to warrant using a boat (shorter distances can be swam)
const MIN_BOAT_DISTANCE = 8;

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

        // Also check the target position itself
        const targetSurface = this.findSurface(bot, Math.floor(targetPos.x), Math.floor(targetPos.z), Math.floor(targetPos.y));
        if (targetSurface.isWater) {
            waterBlockCount += 2; // Weight target more heavily
        } else if (targetSurface.isSolid) {
            solidBlockCount += 2;
        }

        // Evaluate based on findings
        const waterRatio = waterBlockCount / (checkPoints + 2);
        const significantWater = waterBlockCount > checkPoints / 2;

        if (significantWater) {
            // Path has significant water
            if (hasBoat) {
                // With a boat, water paths should be competitive with land paths
                // Boat travel is actually faster than walking, so give good score
                bb.log?.debug?.({ waterCount: waterBlockCount, total: checkPoints }, 'Path goes over water - will use boat');
                requiresBoat = true;
                waterStartPos = firstWaterPos;
                // Base score of 110 (competitive with land paths ~115-130)
                // Small penalty for more water (longer boat ride)
                score = 110 - waterRatio * 10;
            } else {
                // Without a boat, this is a no-go
                bb.log?.trace?.({ waterCount: waterBlockCount, total: checkPoints }, 'Path goes over water - no boat available');
                return { score: -30, requiresBoat: false, waterStartPos: null };
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

            // Penalty for any water (minor)
            score -= waterBlockCount * 5;
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
        try {
            // Step 1: Walk to water's edge
            bb.log?.debug({ pos: waterStartPos.floored().toString() }, 'Walking to water edge');
            const walkGoal = new GoalNear(waterStartPos.x, waterStartPos.y, waterStartPos.z, 3);
            const walkSuccess = await pathfinderGotoWithRetry(bot, walkGoal, 2, 15000);
            if (!walkSuccess) {
                bb.log?.warn('Could not reach water edge');
                return false;
            }

            // Step 2: Find the boat in inventory
            const boatItem = bot.inventory.items().find(i => i.name.includes('boat'));
            if (!boatItem) {
                bb.log?.warn('No boat in inventory');
                return false;
            }

            // Step 3: Find a water block to place the boat on
            const waterBlock = this.findNearbyWater(bot);
            if (!waterBlock) {
                bb.log?.warn('No water nearby to place boat');
                return false;
            }

            bb.log?.debug({ water: waterBlock.position.floored().toString() }, 'Placing boat on water');

            // Equip the boat
            await bot.equip(boatItem, 'hand');
            await sleep(200);

            // Look at the water block
            await bot.lookAt(waterBlock.position.offset(0.5, 1, 0.5));
            await sleep(100);

            // Place the boat (right-click on water)
            try {
                await bot.placeEntity(waterBlock, new Vec3(0, 1, 0));
            } catch (err) {
                bb.log?.debug({ err }, 'placeEntity failed, trying activateBlock');
                // Fallback: try activating the water block
                await bot.activateBlock(waterBlock);
            }
            await sleep(500);

            // Step 4: Find and mount the boat entity
            const boatEntity = this.findNearbyBoatEntity(bot);
            if (!boatEntity) {
                bb.log?.warn('Could not find placed boat entity');
                return false;
            }

            bb.log?.debug({ boatId: boatEntity.id }, 'Mounting boat');
            await bot.mount(boatEntity);
            await sleep(300);

            // Verify we're mounted
            const botWithVehicle = bot as BotWithVehicle;
            if (!botWithVehicle.vehicle) {
                bb.log?.warn('Failed to mount boat');
                return false;
            }

            bb.log?.info('Successfully mounted boat, navigating across water');

            // Step 5: Navigate across water toward destination
            const success = await this.navigateBoatToward(bot, bb, destination);

            // Step 6: Dismount
            if (botWithVehicle.vehicle) {
                bb.log?.debug('Dismounting from boat');
                await bot.dismount();
                await sleep(300);
            }

            // Step 7: Continue on foot to final destination if needed
            if (success) {
                const distToTarget = bot.entity.position.xzDistanceTo(destination);
                if (distToTarget > 10) {
                    bb.log?.debug({ dist: distToTarget.toFixed(1) }, 'Continuing to destination on foot');
                    const finalGoal = new GoalXZ(destination.x, destination.z);
                    await pathfinderGotoWithRetry(bot, finalGoal, 2, 20000);
                }
            }

            return success;
        } catch (err) {
            bb.log?.error({ err }, 'Error during boat crossing');
            // Make sure we dismount if something goes wrong
            const botV = bot as BotWithVehicle;
            if (botV.vehicle) {
                try { await bot.dismount(); } catch { /* ignore */ }
            }
            return false;
        }
    }

    /**
     * Find a water block near the bot that can be used to place a boat.
     */
    private findNearbyWater(bot: Bot): any | null {
        const pos = bot.entity.position;
        const searchRadius = 5;

        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                for (let dy = -2; dy <= 1; dy++) {
                    const checkPos = pos.offset(dx, dy, dz);
                    const block = bot.blockAt(checkPos);
                    if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                        // Verify there's air above for the boat
                        const above = bot.blockAt(checkPos.offset(0, 1, 0));
                        if (above && above.name === 'air') {
                            return block;
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Find a boat entity near the bot.
     */
    private findNearbyBoatEntity(bot: Bot): Entity | null {
        for (const entity of Object.values(bot.entities)) {
            if (entity.name?.includes('boat') && entity.position.distanceTo(bot.entity.position) < 5) {
                return entity;
            }
        }
        return null;
    }

    /**
     * Navigate the boat toward a destination.
     * Uses simple direction-based steering.
     *
     * @param bot - The bot instance
     * @param bb - Blackboard for logging
     * @param destination - Target position
     * @returns true if reached near land or destination
     */
    private async navigateBoatToward(
        bot: Bot,
        bb: LumberjackBlackboard,
        destination: Vec3
    ): Promise<boolean> {
        const maxIterations = 100; // Max ~50 seconds of sailing
        const checkInterval = 500; // Check every 500ms
        const botWithVehicle = bot as BotWithVehicle;

        for (let i = 0; i < maxIterations; i++) {
            if (!botWithVehicle.vehicle) {
                bb.log?.warn('Fell out of boat during navigation');
                return false;
            }

            const pos = bot.entity.position;
            const distToTarget = pos.xzDistanceTo(destination);

            // Check if we're close enough to destination
            if (distToTarget < 15) {
                bb.log?.debug({ dist: distToTarget.toFixed(1) }, 'Close to destination');
                return true;
            }

            // Check if we've reached land (solid block below or nearby)
            if (this.isNearLand(bot, destination)) {
                bb.log?.debug('Reached land');
                return true;
            }

            // Calculate direction to destination
            const direction = destination.minus(pos).normalize();

            // Look toward destination to steer the boat
            const lookTarget = pos.plus(direction.scaled(10));
            await bot.lookAt(lookTarget);

            // Move forward
            bot.setControlState('forward', true);

            await sleep(checkInterval);
        }

        bb.log?.warn('Boat navigation timed out');
        bot.setControlState('forward', false);
        return false;
    }

    /**
     * Check if the bot is near land (solid ground) in the direction of the destination.
     */
    private isNearLand(bot: Bot, destination: Vec3): boolean {
        const pos = bot.entity.position;
        const direction = destination.minus(pos).normalize();

        // Check a few blocks ahead
        for (let dist = 2; dist <= 8; dist += 2) {
            const checkPos = pos.plus(direction.scaled(dist));
            const x = Math.floor(checkPos.x);
            const z = Math.floor(checkPos.z);

            // Check at water level and one below
            for (let y = Math.floor(pos.y) - 1; y <= Math.floor(pos.y) + 1; y++) {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (block && !block.transparent && block.name !== 'water' && block.name !== 'flowing_water') {
                    return true;
                }
            }
        }
        return false;
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
