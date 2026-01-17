import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard, TerraformTask } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

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

        // The request position is now a LAND position (farm center), not water
        // Detect the ground level at the center
        const centerX = Math.floor(request.position.x);
        const centerZ = Math.floor(request.position.z);
        let targetY = Math.floor(request.position.y);

        // Verify/find ground level at center
        for (let y = targetY + 3; y >= targetY - 3; y--) {
            const block = bot.blockAt(new Vec3(centerX, y, centerZ));
            const above = bot.blockAt(new Vec3(centerX, y + 1, centerZ));
            if (block && block.boundingBox === 'block' && block.name !== 'water' &&
                above && (above.name === 'air' || above.name.includes('grass'))) {
                targetY = y;
                break;
            }
        }

        // Find water nearby (within irrigation range)
        let waterPos: Vec3 | null = null;
        const searchRadius = 6;
        for (let dx = -searchRadius; dx <= searchRadius && !waterPos; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius && !waterPos; dz++) {
                for (let dy = -2; dy <= 1; dy++) {
                    const checkPos = new Vec3(centerX + dx, targetY + dy, centerZ + dz);
                    const block = bot.blockAt(checkPos);
                    if (block && block.name === 'water') {
                        waterPos = checkPos.clone();
                        break;
                    }
                }
            }
        }

        if (!waterPos) {
            console.log(`[Landscaper] No water found near farm center at ${request.position.floored()} - skipping`);
            bb.villageChat.announceTerraformDone(request.position);
            return 'failure';
        }

        console.log(`[Landscaper] Starting terraform at ${request.position.floored()}, target Y=${targetY}, water at ${waterPos.floored()}`);

        // Initialize the terraform task
        bb.currentTerraformTask = {
            waterPos: waterPos,
            targetY: targetY,
            phase: 'analyzing',
            blocksToRemove: [],
            blocksToFill: [],
            progress: 0
        };
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
        const radius = 4; // 9x9 area (hydration range from water)

        // Use water position as center of the 9x9 area
        const centerX = Math.floor(waterPos.x);
        const centerZ = Math.floor(waterPos.z);

        const blocksToRemove: Vec3[] = [];
        const blocksToFill: Vec3[] = [];

        console.log(`[Landscaper] Analyzing 9x9 area centered at (${centerX}, ${targetY}, ${centerZ})`);

        // Scan the 9x9 area
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = centerX + dx;
                const z = centerZ + dz;

                // Skip the water source block itself
                if (dx === 0 && dz === 0) continue;

                // Check what's at the target surface level
                const surfacePos = new Vec3(x, targetY, z);
                const surfaceBlock = bot.blockAt(surfacePos);
                const abovePos = new Vec3(x, targetY + 1, z);
                const aboveBlock = bot.blockAt(abovePos);
                const belowPos = new Vec3(x, targetY - 1, z);
                const belowBlock = bot.blockAt(belowPos);

                // Skip if this is water
                if (surfaceBlock?.name === 'water') continue;

                // Case 1: Surface is air - need to fill with dirt
                if (!surfaceBlock || surfaceBlock.name === 'air') {
                    // Check if there's support below or we need to build up
                    if (belowBlock && belowBlock.boundingBox === 'block' && belowBlock.name !== 'water') {
                        blocksToFill.push(surfacePos.clone());
                    } else if (belowBlock?.name === 'water') {
                        // Building over water - need to place dirt
                        blocksToFill.push(surfacePos.clone());
                    } else if (!belowBlock || belowBlock.name === 'air') {
                        // Deep hole - fill from bottom
                        // First fill below, then surface
                        blocksToFill.push(belowPos.clone());
                        blocksToFill.push(surfacePos.clone());
                    }
                }
                // Case 2: Surface has non-farmable block - replace it
                else if (!FARMABLE_BLOCKS.includes(surfaceBlock.name)) {
                    if (SOFT_BLOCKS.includes(surfaceBlock.name) || HARD_BLOCKS.includes(surfaceBlock.name)) {
                        blocksToRemove.push(surfacePos.clone());
                        blocksToFill.push(surfacePos.clone());
                    }
                }
                // Case 3: Surface is good (dirt/grass) - just clear above

                // Clear any blocks above the surface (obstacles)
                for (let y = targetY + 1; y <= targetY + 4; y++) {
                    const pos = new Vec3(x, y, z);
                    const block = bot.blockAt(pos);
                    if (!block || block.name === 'air') continue;

                    // Remove obstacles
                    if (SOFT_BLOCKS.includes(block.name) || HARD_BLOCKS.includes(block.name) ||
                        block.name.includes('_log') || block.name.includes('leaves') ||
                        block.name.includes('grass') || block.name.includes('flower') ||
                        block.name.includes('fern') || block.name.includes('bush')) {
                        blocksToRemove.push(pos.clone());
                    }
                }
            }
        }

        // Sort: dig from top to bottom, fill from bottom to top
        blocksToRemove.sort((a, b) => b.y - a.y);
        blocksToFill.sort((a, b) => a.y - b.y);

        // Remove duplicates from fill list
        const uniqueFills = new Map<string, Vec3>();
        for (const pos of blocksToFill) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (!uniqueFills.has(key)) {
                uniqueFills.set(key, pos);
            }
        }
        task.blocksToFill = Array.from(uniqueFills.values()).sort((a, b) => a.y - b.y);

        task.blocksToRemove = blocksToRemove;
        task.phase = blocksToRemove.length > 0 ? 'digging' : (task.blocksToFill.length > 0 ? 'filling' : 'finishing');

        // Log summary
        const totalWork = blocksToRemove.length + task.blocksToFill.length;
        if (totalWork > 0) {
            console.log(`[Landscaper] Analysis: ${blocksToRemove.length} to dig, ${task.blocksToFill.length} to fill (total: ${totalWork} blocks)`);
            if (blocksToRemove.length > 0) {
                const yLevels = new Set(blocksToRemove.map(b => b.y));
                console.log(`[Landscaper]   Dig at Y: ${[...yLevels].sort((a,b) => a-b).join(', ')}`);
            }
        } else {
            console.log(`[Landscaper] Analysis: Area already suitable at Y=${targetY}`);
        }

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
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(blockPos.x, blockPos.y, blockPos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                console.log(`[Landscaper] Path to dig block failed: ${result.failureReason}`);
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
        const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtItem) {
            console.log(`[Landscaper] Need dirt to fill - searching for dirt nearby`);

            // Try to gather dirt from outside the work area
            const gathered = await this.gatherDirtFromNearby(bot, bb, task);
            if (!gathered) {
                // Couldn't find dirt nearby - skip remaining fills
                console.log(`[Landscaper] No dirt found nearby - completing with partial fill`);
                task.blocksToFill = [];
                task.phase = 'finishing';
                return 'running';
            }
            // Got some dirt, continue filling
            return 'running';
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
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(fillPos.x, fillPos.y, fillPos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                console.log(`[Landscaper] Path to fill block failed: ${result.failureReason}`);
                // Try placing anyway
            }
        }

        // Equip dirt
        const dirtToPlace = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtToPlace) {
            task.blocksToFill.shift();
            return 'running';
        }

        try {
            await bot.equip(dirtToPlace, 'hand');
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

    /**
     * Gather dirt from outside the terraform area when we run out during filling.
     * Searches for dirt/grass blocks in a ring around the work area.
     */
    private async gatherDirtFromNearby(bot: Bot, bb: LandscaperBlackboard, task: TerraformTask): Promise<boolean> {
        const waterPos = task.waterPos;
        const targetY = task.targetY;
        const workRadius = 4; // The 9x9 work area
        const searchRadius = 12; // How far to search for dirt

        // Find dirt blocks outside the work area but nearby
        const dirtPositions: Vec3[] = [];

        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                // Skip blocks inside the work area
                if (Math.abs(dx) <= workRadius && Math.abs(dz) <= workRadius) continue;

                const x = Math.floor(waterPos.x) + dx;
                const z = Math.floor(waterPos.z) + dz;

                // Check at and slightly above/below target level
                for (let dy = -2; dy <= 2; dy++) {
                    const pos = new Vec3(x, targetY + dy, z);
                    const block = bot.blockAt(pos);

                    if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
                        dirtPositions.push(pos.clone());
                    }
                }
            }
        }

        if (dirtPositions.length === 0) {
            console.log(`[Landscaper] No dirt found within ${searchRadius} blocks of work area`);
            return false;
        }

        // Sort by distance to bot
        dirtPositions.sort((a, b) =>
            bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b)
        );

        // Dig up to 16 dirt blocks (or however many we need)
        const neededDirt = Math.min(task.blocksToFill.length, 16);
        let gathered = 0;

        // Equip shovel if we have one
        const shovel = bot.inventory.items().find(i => i.name.includes('shovel'));
        if (shovel) {
            try {
                await bot.equip(shovel, 'hand');
            } catch (e) { /* continue */ }
        }

        for (const dirtPos of dirtPositions) {
            if (gathered >= neededDirt) break;
            if (bb.inventoryFull) break;

            const block = bot.blockAt(dirtPos);
            if (!block || (block.name !== 'dirt' && block.name !== 'grass_block')) continue;

            // Move to the dirt
            const dist = bot.entity.position.distanceTo(dirtPos);
            if (dist > 4) {
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(dirtPos.x, dirtPos.y, dirtPos.z, 3),
                    { timeoutMs: 15000 }
                );
                if (!result.success) {
                    continue; // Skip unreachable dirt
                }
            }

            // Dig it
            try {
                await bot.dig(block);
                gathered++;
                console.log(`[Landscaper] Gathered dirt ${gathered}/${neededDirt} from ${dirtPos.floored()}`);
                await sleep(100);
            } catch (error) {
                // Skip this block
            }
        }

        if (gathered > 0) {
            console.log(`[Landscaper] Gathered ${gathered} dirt blocks for filling`);
            return true;
        }

        return false;
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
