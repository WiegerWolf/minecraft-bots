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
 */
export class GatherDirt implements BehaviorNode {
    name = 'GatherDirt';

    // Target amount of dirt to maintain
    private readonly TARGET_DIRT = 64;
    // How much to gather per action
    private readonly GATHER_BATCH = 16;

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

        // Prefer gathering from established dirtpit, otherwise use village center
        const searchCenter = bb.dirtpit || bb.villageCenter || bot.entity.position;
        const searchRadius = bb.dirtpit ? 30 : 40; // Smaller radius if gathering at dirtpit

        // Find dirt/grass blocks to dig
        const candidates = this.findDirtCandidates(bot, searchCenter, searchRadius);

        if (candidates.length === 0) {
            bb.log?.debug('[Landscaper] No dirt found nearby');
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

        bb.log?.debug({ needed: neededDirt, candidates: candidates.length }, 'Gathering dirt');

        for (const candidate of candidates) {
            if (gathered >= neededDirt) break;
            if (bb.inventoryFull) {
                bb.log?.debug('[Landscaper] Inventory full, stopping dirt gathering');
                break;
            }

            // Check if there's a pending terraform request - stop gathering to respond
            if (bb.hasPendingTerraformRequest) {
                bb.log?.debug('[Landscaper] Terraform request received, stopping dirt gathering');
                break;
            }

            const block = bot.blockAt(candidate.pos);
            if (!block || (block.name !== 'dirt' && block.name !== 'grass_block')) {
                continue;
            }

            // Move close
            const dist = bot.entity.position.distanceTo(candidate.pos);
            if (dist > 4) {
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(candidate.pos.x, candidate.pos.y, candidate.pos.z, 3),
                    { timeoutMs: 15000 }
                );
                if (!result.success) continue;
            }

            // Dig the block
            try {
                const digPos = block.position.clone();
                await bot.dig(block);
                gathered++;
                bb.log?.debug(
                    { pos: candidate.pos.floored().toString(), gathered, needed: neededDirt },
                    'Dug dirt block'
                );

                // Wait for item to spawn and collect it
                await sleep(150);
                await this.collectNearbyDrops(bot, bb, digPos);
            } catch (error) {
                // Skip this block
            }
        }

        if (gathered > 0) {
            bb.log?.info({ gathered, total: bb.dirtCount + gathered }, 'Dirt gathering complete');
            return 'success';
        }

        return 'failure';
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
     * Prefers surface blocks (grass) and avoids areas near water.
     */
    private findDirtCandidates(
        bot: Bot,
        center: Vec3,
        radius: number
    ): { pos: Vec3; score: number }[] {
        const candidates: { pos: Vec3; score: number }[] = [];
        const botPos = bot.entity.position;

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

                    // Score based on: surface preference, distance to bot
                    let score = 50;
                    if (block.name === 'grass_block') score += 20; // Prefer grass (surface)
                    score -= pos.distanceTo(botPos) * 0.5; // Closer is better

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
