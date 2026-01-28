import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard, FarmIssue } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { GoalNear } from 'baritone-ts';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Blocks that need pickaxe
const HARD_BLOCKS = ['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'sandstone'];

/**
 * Farm structure (based on TerraformArea):
 * - 9x9 area centered on water at targetY
 * - All 80 surrounding blocks are dirt/grass/farmland
 * - 2 blocks of clearance above the farm surface
 * - 1-block walkable path around the farm at radius 5
 * - Solid support below the farm surface
 *
 * Issue types handled:
 * - stacked_water: Water below the center water source - fill with dirt
 * - spreading_water: Water in farm area (not center) - fill with dirt
 * - hole: Air/missing block in farm surface or support - fill with dirt
 * - non_farmable: Stone/gravel/etc in farm surface - dig and replace with dirt
 * - obstacle: Solid blocks above farm surface - dig to clear
 * - path_hole: Air/water in path around farm - fill with dirt
 * - path_obstacle: Solid blocks above path - dig to clear
 */
export class MaintainFarm implements BehaviorNode {
    name = 'MaintainFarm';

    private currentFarmIndex = 0;
    private issuesToFix: FarmIssue[] = [];
    private currentFarmPos: Vec3 | null = null;

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // No farms with issues to maintain
        if (bb.farmsWithIssues.length === 0) {
            return 'failure';
        }

        // If we have issues to fix at current farm, continue fixing
        if (this.issuesToFix.length > 0 && this.currentFarmPos) {
            return this.fixNextIssue(bot, bb);
        }

        // Pick a farm with issues (prioritize closest)
        const sortedFarms = [...bb.farmsWithIssues].sort((a, b) =>
            bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b)
        );

        const farmPos = sortedFarms[0]!;
        const farmKey = `${Math.floor(farmPos.x)},${Math.floor(farmPos.y)},${Math.floor(farmPos.z)}`;

        // Get cached issues
        const cached = bb.farmIssuesCache.get(farmKey);
        if (!cached || cached.issues.length === 0) {
            // No issues cached, skip
            return 'failure';
        }

        // Move to the farm if far away
        const distToFarm = bot.entity.position.distanceTo(farmPos);
        if (distToFarm > 16) {
            bb.log?.debug({ pos: farmPos.floored().toString() }, 'Moving to farm for maintenance');
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(farmPos.x, farmPos.y, farmPos.z, 8),
                { timeoutMs: 30000 }
            );
            if (!result.success) {
                bb.log?.warn({ pos: farmPos.floored().toString() }, 'Failed to reach farm for maintenance');
                // Invalidate cache so we don't keep trying
                bb.farmIssuesCache.delete(farmKey);
                return 'failure';
            }
        }

        // Load issues from cache
        this.currentFarmPos = farmPos.clone();
        this.issuesToFix = [...cached.issues]; // Clone the array

        bb.log?.info(
            { pos: farmPos.floored().toString(), issues: this.issuesToFix.length },
            'Found farm issues to fix'
        );

        return this.fixNextIssue(bot, bb);
    }

    /**
     * Fix the next issue in the queue.
     * Handles both filling (placing dirt) and digging (removing blocks).
     */
    private async fixNextIssue(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        if (this.issuesToFix.length === 0) {
            bb.log?.debug({ pos: this.currentFarmPos?.floored().toString() }, 'All farm issues fixed');

            // Clear the cache entry to trigger re-scan
            if (this.currentFarmPos) {
                const farmKey = `${Math.floor(this.currentFarmPos.x)},${Math.floor(this.currentFarmPos.y)},${Math.floor(this.currentFarmPos.z)}`;
                bb.farmIssuesCache.delete(farmKey);
            }

            this.currentFarmPos = null;
            this.currentFarmIndex++;
            return 'success';
        }

        const issue = this.issuesToFix[0]!;

        // Determine if this is a digging or filling issue
        const needsDigging = ['obstacle', 'path_obstacle', 'non_farmable'].includes(issue.type);

        if (needsDigging) {
            return this.digIssue(bot, bb, issue);
        } else {
            return this.fillIssue(bot, bb, issue);
        }
    }

    /**
     * Handle issues that require digging (obstacles, non-farmable blocks).
     */
    private async digIssue(bot: Bot, bb: LandscaperBlackboard, issue: FarmIssue): Promise<BehaviorStatus> {
        const block = bot.blockAt(issue.pos);

        // Check if already cleared
        if (!block || block.name === 'air') {
            // For non_farmable, we need to place dirt after digging
            if (issue.type === 'non_farmable') {
                // Convert to a hole issue to fill
                issue.type = 'hole';
                return this.fillIssue(bot, bb, issue);
            }
            this.issuesToFix.shift();
            return 'running';
        }

        // Check inventory - stop if full
        if (bb.inventoryFull) {
            bb.log?.debug('Inventory full during farm maintenance, pausing');
            return 'failure'; // Let deposit action run
        }

        // Equip appropriate tool
        const needPickaxe = HARD_BLOCKS.includes(block.name);
        const toolType = needPickaxe ? 'pickaxe' : 'shovel';

        if (needPickaxe && !bb.hasPickaxe) {
            bb.log?.debug(`Need pickaxe for ${block.name}`);
            return 'failure';
        }

        if (!needPickaxe && !bb.hasShovel && !bb.hasPickaxe) {
            bb.log?.debug(`Need shovel for ${block.name}`);
            return 'failure';
        }

        const tool = bot.inventory.items().find(i => i.name.includes(toolType));
        if (tool) {
            try {
                await bot.equip(tool, 'hand');
            } catch (error) {
                // Continue without tool
            }
        }

        // Move close to the block
        const dist = bot.entity.position.distanceTo(issue.pos);
        if (dist > 4) {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(issue.pos.x, issue.pos.y, issue.pos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success && dist > 6) {
                bb.log?.warn({ pos: issue.pos.floored().toString() }, 'Cannot reach issue location');
                this.issuesToFix.shift();
                return 'running';
            }
        }

        // Dig the block
        try {
            await bot.dig(block);

            const issueNames: Record<FarmIssue['type'], string> = {
                'obstacle': 'cleared obstacle',
                'path_obstacle': 'cleared path obstacle',
                'non_farmable': 'removed non-farmable block',
                'stacked_water': 'dug',
                'spreading_water': 'dug',
                'hole': 'dug',
                'path_hole': 'dug',
            };
            bb.log?.debug({ pos: issue.pos.floored().toString(), block: block.name }, `Farm maintenance: ${issueNames[issue.type]}`);

            // For non_farmable, convert to hole issue to fill with dirt
            if (issue.type === 'non_farmable') {
                issue.type = 'hole';
                // Don't shift - we'll fill it next
            } else {
                this.issuesToFix.shift();
            }
            await sleep(100);
        } catch (error) {
            bb.log?.debug(
                { pos: issue.pos.floored().toString(), error: error instanceof Error ? error.message : 'unknown' },
                'Failed to dig farm issue'
            );
            this.issuesToFix.shift();
        }

        return 'running';
    }

    /**
     * Handle issues that require filling with dirt.
     */
    private async fillIssue(bot: Bot, bb: LandscaperBlackboard, issue: FarmIssue): Promise<BehaviorStatus> {
        const block = bot.blockAt(issue.pos);

        // Check if already filled (not air/water)
        if (block && block.name !== 'air' && block.name !== 'water' && block.name !== 'flowing_water') {
            this.issuesToFix.shift();
            return 'running';
        }

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

        // Check if bot is standing in the position where we want to place a block
        // If so, move away first to avoid placing block inside ourselves
        const botBlockPos = bot.entity.position.floored();
        const fillBlockPos = issue.pos.floored();
        if (botBlockPos.x === fillBlockPos.x && botBlockPos.z === fillBlockPos.z &&
            (botBlockPos.y === fillBlockPos.y || botBlockPos.y === fillBlockPos.y + 1)) {
            bb.log?.debug({ pos: issue.pos.floored().toString() }, 'Standing in fill position, moving away first');
            // Find a safe spot to stand - try adjacent positions
            // Use closer offsets first (distance 1), then farther (distance 2)
            const safeOffsets = [
                new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
                new Vec3(0, 0, 1), new Vec3(0, 0, -1),
                new Vec3(1, 0, 1), new Vec3(-1, 0, -1),
                new Vec3(1, 0, -1), new Vec3(-1, 0, 1),
                new Vec3(2, 0, 0), new Vec3(-2, 0, 0),
                new Vec3(0, 0, 2), new Vec3(0, 0, -2),
            ];
            let moved = false;
            for (const offset of safeOffsets) {
                // Calculate position where bot would stand (on top of ground)
                const groundPos = issue.pos.plus(offset);
                const groundBlock = bot.blockAt(groundPos);
                const feetPos = groundPos.offset(0, 1, 0);
                const headPos = groundPos.offset(0, 2, 0);
                const blockAtFeet = bot.blockAt(feetPos);
                const blockAtHead = bot.blockAt(headPos);

                // Check: solid ground to stand on, and space for body (feet + head)
                const hasGround = groundBlock && groundBlock.boundingBox === 'block';
                const feetClear = !blockAtFeet || blockAtFeet.name === 'air' || !blockAtFeet.shapes?.length;
                const headClear = !blockAtHead || blockAtHead.name === 'air' || !blockAtHead.shapes?.length;

                if (hasGround && feetClear && headClear) {
                    const result = await smartPathfinderGoto(
                        bot,
                        new GoalNear(feetPos.x, feetPos.y, feetPos.z, 0),
                        { timeoutMs: 5000 }
                    );
                    if (result.success) {
                        moved = true;
                        break;
                    }
                }
            }
            if (!moved) {
                // Last resort: just try to move a bit in any direction
                bb.log?.debug({ pos: issue.pos.floored().toString() }, 'Could not find safe position, trying simple move');
                const simpleOffsets = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
                for (const offset of simpleOffsets) {
                    const targetPos = bot.entity.position.plus(offset);
                    try {
                        await smartPathfinderGoto(bot, new GoalNear(targetPos.x, targetPos.y, targetPos.z, 0), { timeoutMs: 3000 });
                        // Check if we actually moved away from fill position
                        const newBotPos = bot.entity.position.floored();
                        if (newBotPos.x !== fillBlockPos.x || newBotPos.z !== fillBlockPos.z) {
                            moved = true;
                            break;
                        }
                    } catch {
                        // Try next direction
                    }
                }
            }
            if (!moved) {
                bb.log?.debug({ pos: issue.pos.floored().toString() }, 'Could not move away from fill position, will retry later');
                // Move this issue to the end of the queue instead of skipping entirely
                const skippedIssue = this.issuesToFix.shift()!;
                this.issuesToFix.push(skippedIssue);
                return 'running';
            }
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

            const issueNames: Record<FarmIssue['type'], string> = {
                'stacked_water': 'sealed stacked water',
                'spreading_water': 'sealed spreading water',
                'hole': 'filled hole',
                'path_hole': 'filled path hole',
                'non_farmable': 'replaced with dirt',
                'obstacle': 'filled',
                'path_obstacle': 'filled',
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
