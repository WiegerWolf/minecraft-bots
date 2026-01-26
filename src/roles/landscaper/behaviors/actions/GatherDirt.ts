import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GatherDirt - Proactively gather dirt to prepare for terraforming.
 *
 * When the landscaper has nothing better to do, gathering dirt ensures
 * they're ready for incoming terraform requests without delay.
 *
 * Digging pattern: Digs in continuous patterns to create a proper pit,
 * not scattered holes. Tracks last dig position to continue where left off.
 */
export class GatherDirt implements BehaviorNode {
    name = 'GatherDirt';

    // Target amount of dirt to maintain
    private readonly TARGET_DIRT = 64;
    // How much to gather per action
    private readonly GATHER_BATCH = 16;

    // Exclusion zone distances (must match EstablishDirtpit)
    private readonly MIN_DISTANCE_FROM_VILLAGE = 20;
    private readonly MIN_DISTANCE_FROM_FARMS = 20;
    private readonly MIN_DISTANCE_FROM_FORESTS = 15;

    // Track last dig position for continuity (stored on blackboard)
    private lastDigPos: Vec3 | null = null;

    // Max reach for digging (Minecraft default is ~4.5 blocks)
    private readonly DIG_REACH = 4;

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        bb.lastAction = 'gather_dirt';

        // Already have enough dirt
        if (bb.dirtCount >= this.TARGET_DIRT) {
            return 'success';
        }

        // Need a shovel to efficiently gather dirt
        if (!bb.hasShovel) {
            bb.log?.debug('[Landscaper] Need shovel to gather dirt efficiently');
            return 'failure';
        }

        // REQUIRE a dirtpit before gathering - prevents digging near protected areas
        // If no dirtpit, EstablishDirtpit goal should run first
        if (!bb.dirtpit) {
            bb.log?.debug('[Landscaper] Need to establish dirtpit before gathering dirt');
            return 'failure';
        }

        // Equip shovel
        const shovel = bot.inventory.items().find(i => i.name.includes('shovel'));
        if (shovel) {
            try {
                await bot.equip(shovel, 'hand');
            } catch (e) { /* continue */ }
        }

        const neededDirt = Math.min(this.TARGET_DIRT - bb.dirtCount, this.GATHER_BATCH);
        let gathered = 0;

        bb.log?.debug({ needed: neededDirt }, 'Gathering dirt');

        // Main digging loop: stand in one spot, dig everything in reach, then move
        while (gathered < neededDirt) {
            if (bb.inventoryFull) {
                bb.log?.debug('[Landscaper] Inventory full, stopping dirt gathering');
                break;
            }

            // Check if there's a pending terraform request - stop gathering to respond
            if (bb.hasPendingTerraformRequest) {
                bb.log?.debug('[Landscaper] Terraform request received, stopping dirt gathering');
                break;
            }

            // Find all diggable blocks within reach from current position
            const reachable = this.findBlocksWithinReach(bot, bb);

            if (reachable.length > 0) {
                // Dig all reachable blocks without moving
                for (const block of reachable) {
                    if (gathered >= neededDirt) break;

                    try {
                        const digPos = block.position.clone();
                        await bot.dig(block);
                        gathered++;
                        this.lastDigPos = digPos.clone();

                        bb.log?.debug(
                            { pos: digPos.floored().toString(), gathered, needed: neededDirt },
                            'Dug dirt block'
                        );

                        // Brief wait for item drop
                        await sleep(100);
                    } catch (error) {
                        // Skip this block
                    }
                }

                // Collect any dropped items nearby
                await this.collectNearbyDrops(bot, bb, bot.entity.position);
            } else {
                // No blocks in reach - find next dig spot and move there
                const nextSpot = this.findNextDigSpot(bot, bb);

                if (!nextSpot) {
                    bb.log?.debug('[Landscaper] No more dirt to dig');
                    break;
                }

                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(nextSpot.x, nextSpot.y, nextSpot.z, 2),
                    { timeoutMs: 15000 }
                );

                if (!result.success) {
                    bb.log?.debug('[Landscaper] Could not reach next dig spot');
                    break;
                }
            }
        }

        if (gathered > 0) {
            bb.log?.info({ gathered, total: bb.dirtCount + gathered }, 'Dirt gathering complete');
            return 'success';
        }

        return 'failure';
    }

    /**
     * Find all diggable dirt/grass blocks within reach of current position.
     * Returns blocks sorted by distance (closest first).
     */
    private findBlocksWithinReach(bot: Bot, bb: LandscaperBlackboard): any[] {
        const botPos = bot.entity.position;
        const blocks: { block: any; dist: number }[] = [];

        // Check blocks in a cube around the bot
        for (let dx = -this.DIG_REACH; dx <= this.DIG_REACH; dx++) {
            for (let dz = -this.DIG_REACH; dz <= this.DIG_REACH; dz++) {
                for (let dy = -2; dy <= 1; dy++) {
                    const pos = new Vec3(
                        Math.floor(botPos.x) + dx,
                        Math.floor(botPos.y) + dy,
                        Math.floor(botPos.z) + dz
                    );

                    const dist = botPos.distanceTo(pos.offset(0.5, 0.5, 0.5));
                    if (dist > this.DIG_REACH) continue;

                    const block = bot.blockAt(pos);
                    if (!block) continue;
                    if (block.name !== 'dirt' && block.name !== 'grass_block') continue;

                    // Must have air above to be diggable
                    const above = bot.blockAt(pos.offset(0, 1, 0));
                    if (!above || (above.name !== 'air' && !above.name.includes('grass') && !above.name.includes('flower'))) continue;

                    // Check exclusion zones
                    if (bb.villageCenter && pos.distanceTo(bb.villageCenter) < this.MIN_DISTANCE_FROM_VILLAGE) continue;
                    if (bb.knownFarms.some(f => pos.distanceTo(f) < this.MIN_DISTANCE_FROM_FARMS)) continue;
                    if (bb.knownForests.some(f => pos.distanceTo(f) < this.MIN_DISTANCE_FROM_FORESTS)) continue;

                    blocks.push({ block, dist });
                }
            }
        }

        // Sort by distance (closest first) and return just the blocks
        blocks.sort((a, b) => a.dist - b.dist);
        return blocks.map(b => b.block);
    }

    /**
     * Find the next spot to stand for digging.
     * Prefers spots near dirtpit center and near last dig position.
     */
    private findNextDigSpot(bot: Bot, bb: LandscaperBlackboard): Vec3 | null {
        const dirtpit = bb.dirtpit!;
        const botPos = bot.entity.position;
        const candidates: { pos: Vec3; score: number }[] = [];

        // Search in dirtpit area - standing position is ON the surface (y+1)
        for (let dx = -10; dx <= 10; dx++) {
            for (let dz = -10; dz <= 10; dz++) {
                // Standing position: on top of dirtpit surface
                const standPos = new Vec3(
                    Math.floor(dirtpit.x) + dx,
                    Math.floor(dirtpit.y) + 1,  // Stand ON the grass, not IN it
                    Math.floor(dirtpit.z) + dz
                );

                // Check if there's diggable dirt within reach from this standing position
                let hasDirt = false;
                for (let cx = -this.DIG_REACH; cx <= this.DIG_REACH && !hasDirt; cx++) {
                    for (let cz = -this.DIG_REACH; cz <= this.DIG_REACH && !hasDirt; cz++) {
                        for (let cy = -2; cy <= 0 && !hasDirt; cy++) {
                            const checkPos = standPos.offset(cx, cy, cz);
                            if (standPos.distanceTo(checkPos) > this.DIG_REACH) continue;

                            const block = bot.blockAt(checkPos);
                            const above = bot.blockAt(checkPos.offset(0, 1, 0));
                            if (block && (block.name === 'dirt' || block.name === 'grass_block') &&
                                above && (above.name === 'air' || above.name.includes('grass'))) {
                                hasDirt = true;
                            }
                        }
                    }
                }

                if (!hasDirt) continue;

                // Must be able to stand here (solid ground below, air at feet and head)
                const ground = bot.blockAt(standPos.offset(0, -1, 0));
                const feet = bot.blockAt(standPos);
                const head = bot.blockAt(standPos.offset(0, 1, 0));
                if (!ground || ground.boundingBox !== 'block') continue;
                if (!feet || feet.boundingBox === 'block') continue;
                if (!head || head.boundingBox === 'block') continue;

                let score = 0;

                // Prefer spots near dirtpit center
                const distFromCenter = Math.abs(dx) + Math.abs(dz);
                score += 100 - distFromCenter * 5;

                // Prefer spots near bot (minimize travel)
                const distFromBot = botPos.distanceTo(standPos);
                score += 50 - distFromBot * 2;

                // Prefer spots near last dig
                if (this.lastDigPos) {
                    const distFromLast = this.lastDigPos.distanceTo(standPos);
                    score += 30 - distFromLast * 2;
                }

                candidates.push({ pos: standPos, score });
            }
        }

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0]!.pos;
    }

    /**
     * Collect dropped items near a position (after digging).
     * Walks over items to pick them up.
     */
    private async collectNearbyDrops(bot: Bot, bb: LandscaperBlackboard, digPos: Vec3): Promise<void> {
        // Find item entities near where we dug
        const nearbyItems = Object.values(bot.entities).filter(e =>
            e.name === 'item' &&
            e.position &&
            e.position.distanceTo(digPos) < 3
        );

        if (nearbyItems.length === 0) {
            return; // No items to collect
        }

        for (const item of nearbyItems) {
            const itemPos = item.position;
            const dist = bot.entity.position.distanceTo(itemPos);

            // If already very close, wait for auto-pickup
            if (dist < 1.5) {
                await sleep(200);
                continue;
            }

            // Walk over the item to collect it
            try {
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(itemPos.x, itemPos.y, itemPos.z, 0.5),
                    { timeoutMs: 3000 }
                );
                if (result.success) {
                    await sleep(100); // Wait for pickup
                    bb.log?.debug({ pos: itemPos.floored().toString() }, 'Collected dropped dirt');
                }
            } catch {
                // Continue if we can't reach this item
            }
        }
    }

    /**
     * Find dirt/grass blocks suitable for gathering.
     * Prefers continuous digging patterns to create a proper pit.
     * Uses last dig position to continue where left off.
     */
    private findDirtCandidates(
        bot: Bot,
        bb: LandscaperBlackboard,
        center: Vec3,
        radius: number
    ): { pos: Vec3; score: number }[] {
        const candidates: { pos: Vec3; score: number }[] = [];

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = Math.floor(center.x) + dx;
                const z = Math.floor(center.z) + dz;

                // Check surface and a few blocks down
                for (let dy = 5; dy >= -3; dy--) {
                    const pos = new Vec3(x, Math.floor(center.y) + dy, z);
                    const block = bot.blockAt(pos);
                    const above = bot.blockAt(pos.offset(0, 1, 0));

                    if (!block) continue;

                    // Only dirt or grass blocks
                    if (block.name !== 'dirt' && block.name !== 'grass_block') continue;

                    // Must have air or plants above (accessible)
                    const isAccessible = above && (
                        above.name === 'air' ||
                        above.name === 'short_grass' ||
                        above.name === 'tall_grass' ||
                        above.name.includes('flower') ||
                        above.name.includes('fern')
                    );
                    if (!isAccessible) continue;

                    // Avoid blocks near water
                    let nearWater = false;
                    for (let wx = -2; wx <= 2 && !nearWater; wx++) {
                        for (let wz = -2; wz <= 2 && !nearWater; wz++) {
                            for (let wy = -1; wy <= 1; wy++) {
                                const checkBlock = bot.blockAt(pos.offset(wx, wy, wz));
                                if (checkBlock && (checkBlock.name === 'water' || checkBlock.name === 'flowing_water')) {
                                    nearWater = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (nearWater) continue;

                    // === EXCLUSION ZONES (safety net) ===
                    // Avoid village center
                    if (bb.villageCenter && pos.distanceTo(bb.villageCenter) < this.MIN_DISTANCE_FROM_VILLAGE) {
                        continue;
                    }

                    // Avoid farms
                    const nearFarm = bb.knownFarms.some(
                        farm => pos.distanceTo(farm) < this.MIN_DISTANCE_FROM_FARMS
                    );
                    if (nearFarm) continue;

                    // Avoid forests
                    const nearForest = bb.knownForests.some(
                        forest => pos.distanceTo(forest) < this.MIN_DISTANCE_FROM_FORESTS
                    );
                    if (nearForest) continue;

                    // === SCORING FOR EFFICIENT DIGGING ===
                    let score = 0;

                    // 1. HIGHEST PRIORITY: Blocks within the dirtpit area
                    // The dirtpit is typically a small designated area - prefer it over random grass
                    const distFromDirtpitCenter = Math.abs(dx) + Math.abs(dz);
                    if (distFromDirtpitCenter <= 5) {
                        // Within dirtpit area - massive bonus
                        score += 5000;
                        // Extra bonus for being closer to center
                        score += (5 - distFromDirtpitCenter) * 100;
                    }

                    // 2. Prefer dirt blocks over grass (dirt = intentional dirtpit, grass = random)
                    if (block.name === 'dirt') {
                        score += 500;
                    }

                    // 3. Distance from bot - minimize travel time
                    const botPos = bot.entity.position;
                    const distFromBot = Math.abs(pos.x - botPos.x) + Math.abs(pos.z - botPos.z);
                    // Closer blocks get higher score (max 200 points for adjacent)
                    score += Math.max(0, 200 - distFromBot * 10);

                    // 4. Continuity bonus - adjacent to last dig position
                    if (this.lastDigPos) {
                        const distToLast = Math.abs(pos.x - this.lastDigPos.x) + Math.abs(pos.z - this.lastDigPos.z);
                        if (distToLast === 1) {
                            // Directly adjacent (cardinal) - strong continuity
                            score += 1000;
                        } else if (distToLast <= 2) {
                            // Diagonal or very close
                            score += 500;
                        } else if (distToLast <= 4) {
                            // Nearby - maintain area
                            score += 200;
                        }
                    }

                    // 5. Systematic pattern as tiebreaker (row-by-row from corner)
                    // This creates a predictable sweep pattern when other scores are equal
                    const rowScore = 50 - Math.abs(dx) - Math.abs(dz) * 0.5;
                    score += rowScore;

                    candidates.push({ pos: pos.clone(), score });

                    // Only take topmost at each x,z
                    break;
                }
            }
        }

        // Sort by score (highest first)
        candidates.sort((a, b) => b.score - a.score);

        return candidates;
    }
}
