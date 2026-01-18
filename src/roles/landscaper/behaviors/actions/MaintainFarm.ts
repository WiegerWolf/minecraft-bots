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
 * Farm structure:
 * - Top layer (Y): 9x9 dirt with single water source in center
 * - Bottom layer (Y-1): solid blocks (NO water)
 *
 * Common issues to fix:
 * - Stacked water (water at Y-1 under the water source) - fill lower one
 * - Holes in the farm surface - fill with dirt
 * - Water spreading into farm area - seal it
 */

interface FarmIssue {
    type: 'stacked_water' | 'hole' | 'spreading_water';
    pos: Vec3;
}

/**
 * MaintainFarm - Proactively maintain and repair known farms.
 *
 * This runs periodically to:
 * 1. Check each known farm for issues
 * 2. Fix small problems directly (no terraform request needed)
 * 3. Ensure farm structure is correct (2 blocks high, water only on top)
 */
export class MaintainFarm implements BehaviorNode {
    name = 'MaintainFarm';

    private currentFarmIndex = 0;
    private issuesToFix: FarmIssue[] = [];
    private currentFarmPos: Vec3 | null = null;

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // No known farms to maintain
        if (bb.knownFarms.length === 0) {
            return 'failure';
        }

        // If we have issues to fix at current farm, continue fixing
        if (this.issuesToFix.length > 0 && this.currentFarmPos) {
            return this.fixNextIssue(bot, bb);
        }

        // Check if it's time to visit a farm
        // Rotate through farms, checking each every 5 minutes
        const farmPos = bb.knownFarms[this.currentFarmIndex % bb.knownFarms.length]!;
        const farmKey = `${Math.floor(farmPos.x)},${Math.floor(farmPos.y)},${Math.floor(farmPos.z)}`;
        const lastCheck = bb.lastFarmCheckTimes.get(farmKey) || 0;
        const timeSinceCheck = Date.now() - lastCheck;

        // Check farm every 5 minutes
        if (timeSinceCheck < 5 * 60 * 1000) {
            // Move to next farm
            this.currentFarmIndex++;
            if (this.currentFarmIndex >= bb.knownFarms.length) {
                this.currentFarmIndex = 0;
            }
            return 'failure'; // Nothing to do right now
        }

        // Move to the farm if far away
        const distToFarm = bot.entity.position.distanceTo(farmPos);
        if (distToFarm > 16) {
            bb.log?.debug({ pos: farmPos.floored().toString() }, 'Moving to farm for maintenance check');
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(farmPos.x, farmPos.y, farmPos.z, 8),
                { timeoutMs: 30000 }
            );
            if (!result.success) {
                bb.log?.warn({ pos: farmPos.floored().toString() }, 'Failed to reach farm for maintenance');
                bb.lastFarmCheckTimes.set(farmKey, Date.now());
                this.currentFarmIndex++;
                return 'failure';
            }
        }

        // Scan farm for issues
        this.currentFarmPos = farmPos.clone();
        this.issuesToFix = this.scanFarmForIssues(bot, farmPos);
        bb.lastFarmCheckTimes.set(farmKey, Date.now());

        if (this.issuesToFix.length === 0) {
            bb.log?.debug({ pos: farmPos.floored().toString() }, 'Farm is in good condition');
            this.currentFarmIndex++;
            this.currentFarmPos = null;
            return 'success';
        }

        bb.log?.info(
            { pos: farmPos.floored().toString(), issues: this.issuesToFix.length },
            'Found farm issues to fix'
        );

        return this.fixNextIssue(bot, bb);
    }

    /**
     * Scan a farm for maintenance issues.
     * Farm structure should be:
     * - Top layer (farmPos.y): 9x9 dirt with single water source in center
     * - Bottom layer (farmPos.y - 1): solid blocks (NO water)
     */
    private scanFarmForIssues(bot: Bot, farmCenter: Vec3): FarmIssue[] {
        const issues: FarmIssue[] = [];
        const radius = 4; // 9x9 area
        const centerX = Math.floor(farmCenter.x);
        const centerY = Math.floor(farmCenter.y);
        const centerZ = Math.floor(farmCenter.z);

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = centerX + dx;
                const z = centerZ + dz;

                const topPos = new Vec3(x, centerY, z);
                const bottomPos = new Vec3(x, centerY - 1, z);

                const topBlock = bot.blockAt(topPos);
                const bottomBlock = bot.blockAt(bottomPos);

                const isCenter = dx === 0 && dz === 0;

                // Check for stacked water (water below the center water source)
                if (isCenter) {
                    // Center should have water on top
                    if (topBlock && (topBlock.name === 'water' || topBlock.name === 'flowing_water')) {
                        // But should NOT have water below
                        if (bottomBlock && (bottomBlock.name === 'water' || bottomBlock.name === 'flowing_water')) {
                            issues.push({ type: 'stacked_water', pos: bottomPos.clone() });
                        }
                    }
                    continue; // Don't check center for other issues
                }

                // Check top layer (should be farmable: dirt, grass, or farmland)
                if (topBlock) {
                    // Water spreading into farm area - needs sealing
                    if (topBlock.name === 'water' || topBlock.name === 'flowing_water') {
                        issues.push({ type: 'spreading_water', pos: topPos.clone() });
                    }
                    // Hole in farm surface
                    else if (topBlock.name === 'air') {
                        issues.push({ type: 'hole', pos: topPos.clone() });
                    }
                }

                // Check bottom layer (should be solid, NOT water or air)
                if (bottomBlock) {
                    if (bottomBlock.name === 'water' || bottomBlock.name === 'flowing_water') {
                        issues.push({ type: 'stacked_water', pos: bottomPos.clone() });
                    } else if (bottomBlock.name === 'air') {
                        issues.push({ type: 'hole', pos: bottomPos.clone() });
                    }
                }
            }
        }

        // Sort: stacked water first (most important), then spreading water, then holes
        // Also sort by Y (lower first for bottom-up filling)
        issues.sort((a, b) => {
            const typePriority = { 'stacked_water': 0, 'spreading_water': 1, 'hole': 2 };
            const typeCompare = typePriority[a.type] - typePriority[b.type];
            if (typeCompare !== 0) return typeCompare;
            return a.pos.y - b.pos.y; // Fill from bottom up
        });

        return issues;
    }

    /**
     * Fix the next issue in the queue.
     */
    private async fixNextIssue(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        if (this.issuesToFix.length === 0) {
            bb.log?.debug({ pos: this.currentFarmPos?.floored().toString() }, 'All farm issues fixed');
            this.currentFarmPos = null;
            this.currentFarmIndex++;
            return 'success';
        }

        const issue = this.issuesToFix[0]!;

        // Check if we have dirt to place
        const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtItem) {
            bb.log?.debug('No dirt for farm maintenance - need to gather');
            // Don't clear issues, return failure to let GatherDirt run
            return 'failure';
        }

        // Move close to the issue
        const dist = bot.entity.position.distanceTo(issue.pos);
        if (dist > 4) {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(issue.pos.x, issue.pos.y, issue.pos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success && dist > 6) {
                bb.log?.warn({ pos: issue.pos.floored().toString() }, 'Cannot reach farm issue location');
                this.issuesToFix.shift();
                return 'running';
            }
        }

        // Find a surface to place against
        const adjacentOffsets = [
            new Vec3(0, -1, 0), // below (preferred)
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1),
            new Vec3(0, 1, 0), // above
        ];

        let referenceBlock = null;
        let faceVector = null;

        for (const offset of adjacentOffsets) {
            const checkPos = issue.pos.plus(offset);
            const checkBlock = bot.blockAt(checkPos);
            if (checkBlock && checkBlock.boundingBox === 'block' &&
                checkBlock.name !== 'water' && checkBlock.name !== 'flowing_water') {
                referenceBlock = checkBlock;
                faceVector = offset.scaled(-1);
                break;
            }
        }

        if (!referenceBlock) {
            bb.log?.debug({ pos: issue.pos.floored().toString() }, 'No reference block for placement, skipping');
            this.issuesToFix.shift();
            return 'running';
        }

        // Place dirt to fix the issue
        try {
            const dirtToPlace = bot.inventory.items().find(i => i.name === 'dirt');
            if (!dirtToPlace) {
                return 'failure';
            }

            await bot.equip(dirtToPlace, 'hand');
            await sleep(50);
            await bot.placeBlock(referenceBlock, faceVector!);

            const issueNames = {
                'stacked_water': 'sealed stacked water',
                'spreading_water': 'sealed spreading water',
                'hole': 'filled hole'
            };
            bb.log?.debug({ pos: issue.pos.floored().toString() }, `Farm maintenance: ${issueNames[issue.type]}`);

            this.issuesToFix.shift();
            await sleep(100);
        } catch (error) {
            bb.log?.debug(
                { pos: issue.pos.floored().toString(), error: error instanceof Error ? error.message : 'unknown' },
                'Failed to fix farm issue'
            );
            this.issuesToFix.shift();
        }

        return 'running';
    }
}
