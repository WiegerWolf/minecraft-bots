import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard, TerraformTask } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear, GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Blocks that can be easily dug with shovel
const SOFT_BLOCKS = ['dirt', 'grass_block', 'sand', 'gravel', 'clay', 'farmland', 'soul_sand', 'soul_soil'];

// Blocks that need pickaxe
const HARD_BLOCKS = ['stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'sandstone'];

// Blocks that are good for farm surface
const FARMABLE_BLOCKS = ['dirt', 'grass_block', 'farmland'];

/**
 * TerraformArea - Flatten terrain around water for farming
 *
 * Creates a 9x9 flat area (4 blocks in each direction = wheat hydration range)
 * Target Y = water level
 */
export class TerraformArea implements BehaviorNode {
    name = 'TerraformArea';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // If we have an active terraform task, continue it
        if (bb.currentTerraformTask) {
            return this.continueTask(bot, bb);
        }

        // Check for pending requests
        if (!bb.villageChat) return 'failure';

        const pendingRequests = bb.villageChat.getPendingTerraformRequests();
        if (pendingRequests.length === 0) return 'failure';

        // Pick the first pending request
        const request = pendingRequests[0]!;

        // Claim the request
        bb.villageChat.claimTerraformRequest(request.position);

        // Initialize the terraform task
        bb.currentTerraformTask = {
            waterPos: request.position.clone(),
            targetY: request.position.y, // Water Y level is target
            phase: 'analyzing',
            blocksToRemove: [],
            blocksToFill: [],
            progress: 0
        };

        console.log(`[Landscaper] Starting terraform at ${request.position.floored()}`);
        bb.lastAction = 'terraform_start';

        return this.analyzeArea(bot, bb);
    }

    private async continueTask(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;

        switch (task.phase) {
            case 'analyzing':
                return this.analyzeArea(bot, bb);
            case 'digging':
                return this.digBlocks(bot, bb);
            case 'filling':
                return this.fillBlocks(bot, bb);
            case 'finishing':
                return this.finishTask(bot, bb);
            case 'done':
                bb.currentTerraformTask = null;
                return 'success';
            default:
                return 'failure';
        }
    }

    private async analyzeArea(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_analyzing';

        const waterPos = task.waterPos;
        const targetY = task.targetY;
        const radius = 4; // 9x9 area (hydration range)

        const blocksToRemove: Vec3[] = [];
        const blocksToFill: Vec3[] = [];

        // Scan the area
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = Math.floor(waterPos.x) + dx;
                const z = Math.floor(waterPos.z) + dz;

                // Check blocks above target level (need to dig)
                for (let y = targetY; y <= targetY + 5; y++) {
                    const pos = new Vec3(x, y, z);
                    const block = bot.blockAt(pos);
                    if (!block) continue;

                    // Don't remove water
                    if (block.name === 'water') continue;

                    // Above target level - mark for removal
                    if (y > targetY && block.name !== 'air') {
                        // Only remove solid blocks that we can dig
                        if (SOFT_BLOCKS.includes(block.name) || HARD_BLOCKS.includes(block.name) ||
                            block.name.includes('_log') || block.name.includes('leaves')) {
                            blocksToRemove.push(pos.clone());
                        }
                    }
                }

                // Check at target level (surface should be dirt)
                const surfacePos = new Vec3(x, targetY, z);
                const surfaceBlock = bot.blockAt(surfacePos);
                if (surfaceBlock) {
                    // Skip water blocks
                    if (surfaceBlock.name === 'water') continue;

                    // Need to fill if it's air or needs to be replaced with dirt
                    if (surfaceBlock.name === 'air') {
                        blocksToFill.push(surfacePos.clone());
                    } else if (!FARMABLE_BLOCKS.includes(surfaceBlock.name)) {
                        // Non-farmable block at surface - dig and replace
                        blocksToRemove.push(surfacePos.clone());
                        blocksToFill.push(surfacePos.clone());
                    }
                }

                // Check below target level (need to fill holes)
                const belowPos = new Vec3(x, targetY - 1, z);
                const belowBlock = bot.blockAt(belowPos);
                if (belowBlock && belowBlock.name === 'air') {
                    // Hole that needs filling
                    blocksToFill.push(belowPos.clone());
                }
            }
        }

        // Sort: dig from top to bottom, fill from bottom to top
        blocksToRemove.sort((a, b) => b.y - a.y);
        blocksToFill.sort((a, b) => a.y - b.y);

        task.blocksToRemove = blocksToRemove;
        task.blocksToFill = blocksToFill;
        task.phase = blocksToRemove.length > 0 ? 'digging' : (blocksToFill.length > 0 ? 'filling' : 'finishing');

        console.log(`[Landscaper] Analysis complete: ${blocksToRemove.length} to dig, ${blocksToFill.length} to fill`);

        return 'running';
    }

    private async digBlocks(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_digging';

        if (task.blocksToRemove.length === 0) {
            task.phase = task.blocksToFill.length > 0 ? 'filling' : 'finishing';
            return 'running';
        }

        // Check inventory - stop if full
        if (bb.inventoryFull) {
            console.log(`[Landscaper] Inventory full, pausing terraform`);
            return 'failure'; // Let deposit action run
        }

        // Get the next block to dig
        const blockPos = task.blocksToRemove[0]!;
        const block = bot.blockAt(blockPos);

        if (!block || block.name === 'air' || block.name === 'water') {
            // Block already cleared
            task.blocksToRemove.shift();
            task.progress++;
            return 'running';
        }

        // Equip appropriate tool
        const needPickaxe = HARD_BLOCKS.includes(block.name);
        const toolType = needPickaxe ? 'pickaxe' : 'shovel';

        if (needPickaxe && !bb.hasPickaxe) {
            console.log(`[Landscaper] Need pickaxe for ${block.name}`);
            return 'failure'; // Let craft action run
        }

        if (!needPickaxe && !bb.hasShovel && !bb.hasPickaxe) {
            console.log(`[Landscaper] Need shovel for ${block.name}`);
            return 'failure'; // Let craft action run
        }

        // Equip tool
        const tool = bot.inventory.items().find(i => i.name.includes(toolType));
        if (tool) {
            try {
                await bot.equip(tool, 'hand');
            } catch (error) {
                // Continue without tool if equip fails
            }
        }

        // Move close to the block
        const dist = bot.entity.position.distanceTo(blockPos);
        if (dist > 4) {
            try {
                await bot.pathfinder.goto(new GoalNear(blockPos.x, blockPos.y, blockPos.z, 3));
            } catch (error) {
                console.log(`[Landscaper] Path to dig block failed: ${error instanceof Error ? error.message : 'unknown'}`);
                // Try digging anyway if we're somewhat close
                if (dist > 6) {
                    return 'failure';
                }
            }
        }

        // Dig the block
        try {
            await bot.dig(block);
            console.log(`[Landscaper] Dug ${block.name} at ${blockPos.floored()}`);
            task.blocksToRemove.shift();
            task.progress++;
            await sleep(100);
        } catch (error) {
            console.log(`[Landscaper] Dig failed at ${blockPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
            // Skip this block
            task.blocksToRemove.shift();
        }

        return 'running';
    }

    private async fillBlocks(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_filling';

        if (task.blocksToFill.length === 0) {
            task.phase = 'finishing';
            return 'running';
        }

        // Check if we have dirt
        if (bb.dirtCount === 0) {
            console.log(`[Landscaper] Need dirt to fill`);
            // Try to continue anyway - maybe we just collected some
            const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
            if (!dirtItem) {
                // Check if we dug up enough during digging phase
                // If not, mark remaining fills as skipped and continue
                if (task.blocksToFill.length > 0) {
                    console.log(`[Landscaper] Skipping fill phase - no dirt available`);
                    task.blocksToFill = [];
                    task.phase = 'finishing';
                }
                return 'running';
            }
        }

        const fillPos = task.blocksToFill[0]!;
        const block = bot.blockAt(fillPos);

        // Check if block already filled
        if (block && block.name !== 'air' && block.name !== 'water') {
            task.blocksToFill.shift();
            task.progress++;
            return 'running';
        }

        // Find a surface to place against
        const adjacentOffsets = [
            new Vec3(0, -1, 0), // below
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1),
            new Vec3(0, 1, 0), // above
        ];

        let referenceBlock = null;
        let faceVector = null;

        for (const offset of adjacentOffsets) {
            const checkPos = fillPos.plus(offset);
            const checkBlock = bot.blockAt(checkPos);
            if (checkBlock && checkBlock.boundingBox === 'block' && checkBlock.name !== 'water') {
                referenceBlock = checkBlock;
                faceVector = offset.scaled(-1); // Face toward fill position
                break;
            }
        }

        if (!referenceBlock) {
            console.log(`[Landscaper] No reference block to place dirt at ${fillPos.floored()}`);
            task.blocksToFill.shift();
            return 'running';
        }

        // Move close
        const dist = bot.entity.position.distanceTo(fillPos);
        if (dist > 4) {
            try {
                await bot.pathfinder.goto(new GoalNear(fillPos.x, fillPos.y, fillPos.z, 3));
            } catch (error) {
                // Try placing anyway
            }
        }

        // Equip dirt
        const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtItem) {
            task.blocksToFill.shift();
            return 'running';
        }

        try {
            await bot.equip(dirtItem, 'hand');
            await sleep(50);
            await bot.placeBlock(referenceBlock, faceVector!);
            console.log(`[Landscaper] Placed dirt at ${fillPos.floored()}`);
            task.blocksToFill.shift();
            task.progress++;
            await sleep(100);
        } catch (error) {
            console.log(`[Landscaper] Place dirt failed at ${fillPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
            task.blocksToFill.shift();
        }

        return 'running';
    }

    private async finishTask(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_done';

        // Announce completion
        if (bb.villageChat) {
            bb.villageChat.announceTerraformDone(task.waterPos);
        }

        console.log(`[Landscaper] Terraform complete at ${task.waterPos.floored()}`);

        task.phase = 'done';
        bb.currentTerraformTask = null;

        return 'success';
    }
}
