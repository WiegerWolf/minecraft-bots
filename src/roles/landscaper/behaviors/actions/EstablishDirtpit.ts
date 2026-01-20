import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { formatSignText } from '../../../../shared/SignKnowledge';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * EstablishDirtpit - Find and establish a dedicated dirt gathering location.
 *
 * The dirtpit should be:
 * - Away from village center, farms, and forests
 * - In an area with high dirt/grass block density
 * - Marked with a sign so other bots can learn about it
 */
export class EstablishDirtpit implements BehaviorNode {
    name = 'EstablishDirtpit';

    // Minimum distance from village center and other resources
    private readonly MIN_DISTANCE_FROM_VILLAGE = 50;
    private readonly MIN_DISTANCE_FROM_FARMS = 30;
    private readonly MIN_DISTANCE_FROM_FORESTS = 20;

    // Search parameters
    private readonly SEARCH_RADIUS = 80;
    private readonly SAMPLE_GRID_SIZE = 10; // Check every 10 blocks
    private readonly MIN_DIRT_DENSITY = 0.4; // At least 40% of sampled blocks should be dirt/grass

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        bb.lastAction = 'establish_dirtpit';

        // Already have a dirtpit
        if (bb.dirtpit) {
            return 'success';
        }

        // Need a village center to establish relative position
        if (!bb.villageCenter) {
            bb.log?.debug('[Landscaper] Need village center before establishing dirtpit');
            return 'failure';
        }

        bb.log?.info('[Landscaper] Searching for dirtpit location...');

        // Find the best dirtpit candidate
        const candidate = this.findBestDirtpitCandidate(bot, bb);

        if (!candidate) {
            bb.log?.warn('[Landscaper] Could not find suitable dirtpit location');
            return 'failure';
        }

        bb.log?.info({ pos: candidate.floored().toString(), score: 'high' }, '[Landscaper] Found dirtpit candidate');

        // Establish the dirtpit
        bb.dirtpit = candidate;
        bb.hasDirtpit = true;

        // Try to place a sign at spawn to mark the dirtpit
        if (bb.spawnPosition) {
            await this.tryPlaceSign(bot, bb, candidate);
        }

        bb.log?.info({ pos: candidate.floored().toString() }, '[Landscaper] Established dirtpit');
        return 'success';
    }

    /**
     * Find the best candidate location for a dirtpit.
     * Returns the center position of the best dirt-dense area.
     */
    private findBestDirtpitCandidate(bot: Bot, bb: LandscaperBlackboard): Vec3 | null {
        const villageCenter = bb.villageCenter!;
        const candidates: { pos: Vec3; score: number }[] = [];

        // Sample grid positions in a large radius around village
        for (let dx = -this.SEARCH_RADIUS; dx <= this.SEARCH_RADIUS; dx += this.SAMPLE_GRID_SIZE) {
            for (let dz = -this.SEARCH_RADIUS; dz <= this.SEARCH_RADIUS; dz += this.SAMPLE_GRID_SIZE) {
                const samplePos = new Vec3(
                    Math.floor(villageCenter.x) + dx,
                    Math.floor(villageCenter.y),
                    Math.floor(villageCenter.z) + dz
                );

                // Check distance constraints
                const distFromVillage = samplePos.distanceTo(villageCenter);
                if (distFromVillage < this.MIN_DISTANCE_FROM_VILLAGE) continue;

                // Check distance from farms
                const tooCloseToFarm = bb.knownFarms.some(
                    farm => samplePos.distanceTo(farm) < this.MIN_DISTANCE_FROM_FARMS
                );
                if (tooCloseToFarm) continue;

                // Calculate dirt density in this area
                const density = this.calculateDirtDensity(bot, samplePos);
                if (density < this.MIN_DIRT_DENSITY) continue;

                // Score based on: dirt density and distance from village (prefer further)
                const score = density * 100 + distFromVillage * 0.5;

                candidates.push({ pos: samplePos, score });
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        // Sort by score (highest first)
        candidates.sort((a, b) => b.score - a.score);

        return candidates[0]!.pos;
    }

    /**
     * Calculate the dirt/grass density in an area around a position.
     * Returns a value between 0 and 1.
     */
    private calculateDirtDensity(bot: Bot, center: Vec3): number {
        const sampleRadius = 8;
        let dirtCount = 0;
        let totalCount = 0;

        for (let dx = -sampleRadius; dx <= sampleRadius; dx += 2) {
            for (let dz = -sampleRadius; dz <= sampleRadius; dz += 2) {
                // Find the surface block at this position
                for (let dy = 5; dy >= -5; dy--) {
                    const pos = new Vec3(
                        Math.floor(center.x) + dx,
                        Math.floor(center.y) + dy,
                        Math.floor(center.z) + dz
                    );
                    const block = bot.blockAt(pos);
                    const above = bot.blockAt(pos.offset(0, 1, 0));

                    if (!block || !above) continue;

                    // Surface block: solid with air or plants above
                    if (block.boundingBox === 'block' &&
                        (above.name === 'air' || above.name === 'short_grass' || above.name === 'tall_grass')) {

                        totalCount++;
                        if (block.name === 'dirt' || block.name === 'grass_block') {
                            dirtCount++;
                        }
                        break; // Only count topmost surface
                    }
                }
            }
        }

        if (totalCount === 0) return 0;
        return dirtCount / totalCount;
    }

    /**
     * Try to place a sign at spawn to mark the dirtpit location.
     */
    private async tryPlaceSign(bot: Bot, bb: LandscaperBlackboard, dirtpitPos: Vec3): Promise<void> {
        // Check if we have a sign
        const sign = bot.inventory.items().find(i => i.name.includes('_sign'));
        if (!sign) {
            bb.log?.debug('[Landscaper] No sign available to mark dirtpit');
            return;
        }

        // Find a place to put the sign near spawn
        const spawnPos = bb.spawnPosition!;
        const signPos = this.findSignPlacement(bot, spawnPos);

        if (!signPos) {
            bb.log?.debug('[Landscaper] No suitable place to put dirtpit sign');
            return;
        }

        try {
            // Move to sign placement position
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(signPos.x, signPos.y, signPos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                bb.log?.debug('[Landscaper] Could not reach sign placement position');
                return;
            }

            // Equip and place the sign
            await bot.equip(sign, 'hand');
            const groundBlock = bot.blockAt(signPos.offset(0, -1, 0));

            if (groundBlock && groundBlock.boundingBox === 'block') {
                await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                await sleep(100);

                // Set sign text
                const signBlock = bot.blockAt(signPos);
                if (signBlock && signBlock.name.includes('_sign')) {
                    const signText = formatSignText('DIRTPIT', dirtpitPos);
                    try {
                        await (bot as any).updateSign(signBlock, signText.join('\n'));
                        bb.log?.info({ pos: signPos.floored().toString() }, '[Landscaper] Placed dirtpit sign');
                    } catch (err) {
                        bb.log?.debug({ err }, '[Landscaper] Could not update sign text');
                    }
                }
            }
        } catch (err) {
            bb.log?.debug({ err }, '[Landscaper] Failed to place dirtpit sign');
        }
    }

    /**
     * Find a suitable position to place a sign near spawn.
     */
    private findSignPlacement(bot: Bot, spawnPos: Vec3): Vec3 | null {
        // Check positions in a grid near spawn
        for (let dx = 2; dx <= 6; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const pos = new Vec3(
                    Math.floor(spawnPos.x) + dx,
                    Math.floor(spawnPos.y),
                    Math.floor(spawnPos.z) + dz
                );

                // Find valid Y for sign placement
                for (let dy = 3; dy >= -3; dy--) {
                    const checkPos = pos.offset(0, dy, 0);
                    const ground = bot.blockAt(checkPos.offset(0, -1, 0));
                    const target = bot.blockAt(checkPos);
                    const above = bot.blockAt(checkPos.offset(0, 1, 0));

                    if (ground && ground.boundingBox === 'block' &&
                        target && target.name === 'air' &&
                        above && above.name === 'air') {
                        return checkPos;
                    }
                }
            }
        }

        return null;
    }
}
