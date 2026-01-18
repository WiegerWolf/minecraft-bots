import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard, TerraformTask } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

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
 * TerraformArea - Create a 9x9 flat dirt area centered on a water source
 *
 * The water block stays in the CENTER for irrigation.
 * All 80 surrounding blocks become dirt at the same Y level as the water.
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

        // Pick the first pending request - the position IS the water block
        const request = pendingRequests[0]!;
        const waterPos = request.position.clone();

        // Claim the request
        bb.villageChat.claimTerraformRequest(waterPos);

        // Move closer if needed (chunks must be loaded to scan)
        const distToRequest = bot.entity.position.distanceTo(waterPos);
        if (distToRequest > 32) {
            bb.log?.debug(`[Landscaper] Moving to terraform area at ${waterPos.floored()} (${Math.round(distToRequest)} blocks away)`);
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(waterPos.x, waterPos.y, waterPos.z, 16),
                { timeoutMs: 30000 }
            );
            if (!result.success) {
                bb.log?.debug(`[Landscaper] Failed to reach terraform area: ${result.failureReason}`);
                bb.villageChat.releaseTerraformClaim(waterPos);
                return 'failure';
            }
        }

        // Verify the center block is water
        const centerBlock = bot.blockAt(waterPos);
        if (!centerBlock || (centerBlock.name !== 'water' && centerBlock.name !== 'flowing_water')) {
            bb.log?.debug(`[Landscaper] Request position is not water (found: ${centerBlock?.name || 'null'}) at ${waterPos.floored()}`);
            bb.villageChat.releaseTerraformClaim(waterPos);
            return 'failure';
        }

        const targetY = Math.floor(waterPos.y);
        bb.log?.debug(`[Landscaper] Starting 9x9 terraform centered on water at ${waterPos.floored()}, target Y=${targetY}`);

        // Initialize the terraform task
        bb.currentTerraformTask = {
            waterCenter: waterPos.floored(),
            targetY: targetY,
            phase: 'analyzing',
            blocksToRemove: [],
            waterBlocksToFill: [],  // Water blocks to seal BEFORE digging
            blocksToFill: [],       // Regular fills AFTER digging
            pathBlocksToClear: [],  // Blocks to remove for 1-block path
            pathBlocksToFill: [],   // Holes to fill in the path
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
            case 'sealing_water':
                return this.sealWaterBlocks(bot, bb);  // Fill water BEFORE digging
            case 'digging':
                return this.digBlocks(bot, bb);
            case 'filling':
                return this.fillBlocks(bot, bb);
            case 'clearing_path':
                return this.clearPath(bot, bb);  // Create 1-block path around farm
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

        const waterCenter = task.waterCenter;
        const targetY = task.targetY;
        const radius = 4; // 9x9 area = 4 blocks in each direction

        const centerX = Math.floor(waterCenter.x);
        const centerZ = Math.floor(waterCenter.z);

        const blocksToRemove: Vec3[] = [];
        const waterBlocksToFill: Vec3[] = [];  // Water blocks - fill FIRST to prevent spreading
        const blocksToFill: Vec3[] = [];       // Regular fills - after digging

        bb.log?.debug(`[Landscaper] Analyzing 9x9 area centered on water at (${centerX}, ${targetY}, ${centerZ})`);

        // Scan the 9x9 area
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = centerX + dx;
                const z = centerZ + dz;

                // SKIP the center water block - we keep it!
                if (dx === 0 && dz === 0) continue;

                const surfacePos = new Vec3(x, targetY, z);
                const surfaceBlock = bot.blockAt(surfacePos);
                const abovePos = new Vec3(x, targetY + 1, z);
                const belowPos = new Vec3(x, targetY - 1, z);
                const belowBlock = bot.blockAt(belowPos);

                // Case 1: Surface is water - PRIORITY: fill before digging anything
                if (surfaceBlock && (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water')) {
                    waterBlocksToFill.push(surfacePos.clone());
                }
                // Case 2: Surface is air - regular fill (after digging)
                else if (!surfaceBlock || surfaceBlock.name === 'air') {
                    blocksToFill.push(surfacePos.clone());
                }
                // Case 3: Surface has a block but it's not farmable - dig and replace
                else if (!FARMABLE_BLOCKS.includes(surfaceBlock.name)) {
                    if (SOFT_BLOCKS.includes(surfaceBlock.name) || HARD_BLOCKS.includes(surfaceBlock.name)) {
                        blocksToRemove.push(surfacePos.clone());
                        blocksToFill.push(surfacePos.clone());
                    }
                }
                // Case 4: Surface is already farmable (dirt/grass) - good, just clear above

                // Clear any blocks above the surface
                for (let y = targetY + 1; y <= targetY + 4; y++) {
                    const pos = new Vec3(x, y, z);
                    const block = bot.blockAt(pos);
                    if (!block || block.name === 'air') continue;

                    // Remove obstacles (trees, tall grass, etc)
                    if (SOFT_BLOCKS.includes(block.name) || HARD_BLOCKS.includes(block.name) ||
                        block.name.includes('_log') || block.name.includes('leaves') ||
                        block.name.includes('grass') || block.name.includes('flower') ||
                        block.name.includes('fern') || block.name.includes('bush')) {
                        blocksToRemove.push(pos.clone());
                    }
                }

                // Check for holes/water below that need filling (support for farm surface)
                if (belowBlock) {
                    if (belowBlock.name === 'water' || belowBlock.name === 'flowing_water') {
                        waterBlocksToFill.push(belowPos.clone());
                    } else if (belowBlock.name === 'air') {
                        blocksToFill.push(belowPos.clone());
                    }
                }
            }
        }

        // Sort: dig from top to bottom, fill from bottom to top
        blocksToRemove.sort((a, b) => b.y - a.y);
        waterBlocksToFill.sort((a, b) => a.y - b.y);
        blocksToFill.sort((a, b) => a.y - b.y);

        // Remove duplicates
        const uniqueWaterFills = new Map<string, Vec3>();
        for (const pos of waterBlocksToFill) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (!uniqueWaterFills.has(key)) {
                uniqueWaterFills.set(key, pos);
            }
        }
        task.waterBlocksToFill = Array.from(uniqueWaterFills.values()).sort((a, b) => a.y - b.y);

        const uniqueFills = new Map<string, Vec3>();
        for (const pos of blocksToFill) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (!uniqueFills.has(key)) {
                uniqueFills.set(key, pos);
            }
        }
        task.blocksToFill = Array.from(uniqueFills.values()).sort((a, b) => a.y - b.y);
        task.blocksToRemove = blocksToRemove;

        // ═══════════════════════════════════════════════════════════════
        // ANALYZE PATH RING (1-block walkable path around the 9x9 farm)
        // Path is at radius 5 (immediately outside the 9x9 farm area)
        // ═══════════════════════════════════════════════════════════════
        const pathRadius = 5; // Just outside the 9x9 farm (radius 4)
        const pathBlocksToClear: Vec3[] = [];
        const pathBlocksToFill: Vec3[] = [];

        // Scan the path ring (blocks at exactly distance 5 in X or Z)
        for (let dx = -pathRadius; dx <= pathRadius; dx++) {
            for (let dz = -pathRadius; dz <= pathRadius; dz++) {
                // Only include blocks on the outer ring (not inside the farm)
                const isOnPathRing = Math.abs(dx) === pathRadius || Math.abs(dz) === pathRadius;
                if (!isOnPathRing) continue;

                const x = centerX + dx;
                const z = centerZ + dz;
                const pathPos = new Vec3(x, targetY, z);
                const pathBlock = bot.blockAt(pathPos);

                // Clear any blocks above the path (2 blocks high for walking)
                for (let y = targetY + 1; y <= targetY + 2; y++) {
                    const abovePos = new Vec3(x, y, z);
                    const aboveBlock = bot.blockAt(abovePos);
                    if (!aboveBlock || aboveBlock.name === 'air') continue;

                    // Remove solid blocks, leaves, logs, plants
                    if (aboveBlock.boundingBox === 'block' ||
                        aboveBlock.name.includes('leaves') || aboveBlock.name.includes('_log') ||
                        aboveBlock.name.includes('grass') || aboveBlock.name.includes('fern') ||
                        aboveBlock.name.includes('flower') || aboveBlock.name.includes('bush')) {
                        pathBlocksToClear.push(abovePos.clone());
                    }
                }

                // Check path surface: need solid walkable ground
                if (!pathBlock || pathBlock.name === 'air') {
                    // Hole in path - needs filling
                    pathBlocksToFill.push(pathPos.clone());
                } else if (pathBlock.name === 'water' || pathBlock.name === 'flowing_water') {
                    // Water in path - needs filling
                    pathBlocksToFill.push(pathPos.clone());
                }
                // If it's a solid block, path surface is OK

                // Check below path surface - need support
                const belowPath = new Vec3(x, targetY - 1, z);
                const belowBlock = bot.blockAt(belowPath);
                if (belowBlock && (belowBlock.name === 'air' || belowBlock.name === 'water' || belowBlock.name === 'flowing_water')) {
                    pathBlocksToFill.push(belowPath.clone());
                }
            }
        }

        // Sort and dedupe path blocks
        pathBlocksToClear.sort((a, b) => b.y - a.y); // Top-down for clearing

        const uniquePathFills = new Map<string, Vec3>();
        for (const pos of pathBlocksToFill) {
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (!uniquePathFills.has(key)) {
                uniquePathFills.set(key, pos);
            }
        }
        task.pathBlocksToClear = pathBlocksToClear;
        task.pathBlocksToFill = Array.from(uniquePathFills.values()).sort((a, b) => a.y - b.y);

        // Determine next phase - SEAL WATER FIRST, then dig, then fill, then path
        if (task.waterBlocksToFill.length > 0) {
            task.phase = 'sealing_water';
        } else if (blocksToRemove.length > 0) {
            task.phase = 'digging';
        } else if (task.blocksToFill.length > 0) {
            task.phase = 'filling';
        } else if (task.pathBlocksToClear.length > 0 || task.pathBlocksToFill.length > 0) {
            task.phase = 'clearing_path';
        } else {
            task.phase = 'finishing';
        }

        // Log summary
        const totalWork = blocksToRemove.length + task.waterBlocksToFill.length + task.blocksToFill.length;
        const pathWork = task.pathBlocksToClear.length + task.pathBlocksToFill.length;
        if (totalWork > 0 || pathWork > 0) {
            bb.log?.debug(`[Landscaper] Work needed: ${task.waterBlocksToFill.length} water to seal, ${blocksToRemove.length} to dig, ${task.blocksToFill.length} to fill, path: ${task.pathBlocksToClear.length} clear + ${task.pathBlocksToFill.length} fill`);
        } else {
            bb.log?.debug(`[Landscaper] Area already suitable - 9x9 dirt with water center and path`);
        }

        return 'running';
    }

    /**
     * Seal water blocks by filling them with dirt BEFORE digging.
     * This prevents the water source from spreading when we dig adjacent blocks.
     */
    private async sealWaterBlocks(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_sealing';

        if (task.waterBlocksToFill.length === 0) {
            // Done sealing water, move to digging
            task.phase = task.blocksToRemove.length > 0 ? 'digging' : (task.blocksToFill.length > 0 ? 'filling' : 'finishing');
            bb.log?.debug(`[Landscaper] Water sealed, moving to ${task.phase} phase`);
            return 'running';
        }

        // Check if we have dirt
        const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtItem) {
            bb.log?.debug(`[Landscaper] Need dirt to seal water - gathering from inland`);
            const gathered = await this.gatherDirtFromNearby(bot, bb, task);
            if (!gathered) {
                bb.log?.debug(`[Landscaper] No dirt found - skipping water seal (may cause water flow issues)`);
                task.waterBlocksToFill = [];
                task.phase = task.blocksToRemove.length > 0 ? 'digging' : 'finishing';
                return 'running';
            }
            return 'running';
        }

        const fillPos = task.waterBlocksToFill[0]!;
        const block = bot.blockAt(fillPos);

        // Check if already filled (or no longer water)
        if (block && block.name !== 'water' && block.name !== 'flowing_water' && block.name !== 'air') {
            task.waterBlocksToFill.shift();
            task.progress++;
            return 'running';
        }

        // Find a surface to place against - for water, we can place on top of adjacent blocks
        const adjacentOffsets = [
            new Vec3(0, -1, 0), // below (preferred - place on seabed)
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1),
            new Vec3(0, 1, 0),
        ];

        let referenceBlock = null;
        let faceVector = null;

        for (const offset of adjacentOffsets) {
            const checkPos = fillPos.plus(offset);
            const checkBlock = bot.blockAt(checkPos);
            // Can place against solid blocks (including other dirt we've placed)
            if (checkBlock && checkBlock.boundingBox === 'block' &&
                checkBlock.name !== 'water' && checkBlock.name !== 'flowing_water') {
                referenceBlock = checkBlock;
                faceVector = offset.scaled(-1);
                break;
            }
        }

        if (!referenceBlock) {
            bb.log?.debug(`[Landscaper] No reference block to seal water at ${fillPos.floored()}, skipping`);
            task.waterBlocksToFill.shift();
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
                // Try placing anyway if we're somewhat close
            }
        }

        // Equip and place dirt
        const dirtToPlace = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtToPlace) {
            task.waterBlocksToFill.shift();
            return 'running';
        }

        try {
            await bot.equip(dirtToPlace, 'hand');
            await sleep(50);
            await bot.placeBlock(referenceBlock, faceVector!);
            bb.log?.debug(`[Landscaper] Sealed water at ${fillPos.floored()}`);
            task.waterBlocksToFill.shift();
            task.progress++;
            await sleep(100);
        } catch (error) {
            bb.log?.debug(`[Landscaper] Failed to seal water at ${fillPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
            task.waterBlocksToFill.shift();
        }

        return 'running';
    }

    /**
     * Check for water that has flowed into the work area during digging.
     * Returns positions of any new water blocks that need to be sealed.
     */
    private detectFlowingWater(bot: Bot, task: TerraformTask): Vec3[] {
        const waterCenter = task.waterCenter;
        const targetY = task.targetY;
        const radius = 4;
        const centerX = Math.floor(waterCenter.x);
        const centerZ = Math.floor(waterCenter.z);
        const newWater: Vec3[] = [];

        // Scan the 9x9 area for any water blocks (except center)
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                // Skip the center water block
                if (dx === 0 && dz === 0) continue;

                const x = centerX + dx;
                const z = centerZ + dz;

                // Check at target Y and one below (where water might flow)
                for (let dy = 0; dy >= -1; dy--) {
                    const pos = new Vec3(x, targetY + dy, z);
                    const block = bot.blockAt(pos);

                    if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                        // Check if we already know about this water
                        const posKey = `${pos.x},${pos.y},${pos.z}`;
                        const alreadyTracked = task.waterBlocksToFill.some(
                            p => `${p.x},${p.y},${p.z}` === posKey
                        );
                        if (!alreadyTracked) {
                            newWater.push(pos.clone());
                        }
                    }
                }
            }
        }

        return newWater;
    }

    private async digBlocks(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_digging';

        // PRIORITY CHECK: Detect any water that has flowed in and seal it immediately
        const flowingWater = this.detectFlowingWater(bot, task);
        if (flowingWater.length > 0) {
            bb.log?.warn(`[Landscaper] Water detected during digging! ${flowingWater.length} blocks to seal`);
            // Add new water blocks to the front of the seal list (high priority)
            task.waterBlocksToFill = [...flowingWater, ...task.waterBlocksToFill];
            task.phase = 'sealing_water';
            return 'running';
        }

        if (task.blocksToRemove.length === 0) {
            task.phase = task.blocksToFill.length > 0 ? 'filling' : 'finishing';
            return 'running';
        }

        // Check inventory - stop if full
        if (bb.inventoryFull) {
            bb.log?.debug(`[Landscaper] Inventory full, pausing terraform`);
            return 'failure'; // Let deposit action run
        }

        const blockPos = task.blocksToRemove[0]!;
        const block = bot.blockAt(blockPos);

        if (!block || block.name === 'air' || block.name === 'water') {
            task.blocksToRemove.shift();
            task.progress++;
            return 'running';
        }

        // Equip appropriate tool
        const needPickaxe = HARD_BLOCKS.includes(block.name);
        const toolType = needPickaxe ? 'pickaxe' : 'shovel';

        if (needPickaxe && !bb.hasPickaxe) {
            bb.log?.debug(`[Landscaper] Need pickaxe for ${block.name}`);
            return 'failure';
        }

        if (!needPickaxe && !bb.hasShovel && !bb.hasPickaxe) {
            bb.log?.debug(`[Landscaper] Need shovel for ${block.name}`);
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
        const dist = bot.entity.position.distanceTo(blockPos);
        if (dist > 4) {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(blockPos.x, blockPos.y, blockPos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success && dist > 6) {
                return 'failure';
            }
        }

        // Dig the block
        try {
            await bot.dig(block);
            bb.log?.debug(`[Landscaper] Dug ${block.name} at ${blockPos.floored()}`);
            task.blocksToRemove.shift();
            task.progress++;
            await sleep(100);
        } catch (error) {
            bb.log?.debug(`[Landscaper] Dig failed at ${blockPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
            task.blocksToRemove.shift();
        }

        return 'running';
    }

    private async fillBlocks(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_filling';

        // PRIORITY CHECK: Detect any water that has flowed in and seal it immediately
        const flowingWater = this.detectFlowingWater(bot, task);
        if (flowingWater.length > 0) {
            bb.log?.warn(`[Landscaper] Water detected during filling! ${flowingWater.length} blocks to seal`);
            task.waterBlocksToFill = [...flowingWater, ...task.waterBlocksToFill];
            task.phase = 'sealing_water';
            return 'running';
        }

        if (task.blocksToFill.length === 0) {
            // Move to path clearing if there's work, otherwise finish
            if (task.pathBlocksToClear.length > 0 || task.pathBlocksToFill.length > 0) {
                task.phase = 'clearing_path';
            } else {
                task.phase = 'finishing';
            }
            return 'running';
        }

        // Check if we have dirt
        const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtItem) {
            bb.log?.debug(`[Landscaper] Need dirt - gathering from nearby`);
            const gathered = await this.gatherDirtFromNearby(bot, bb, task);
            if (!gathered) {
                bb.log?.debug(`[Landscaper] No dirt found - completing with partial fill`);
                task.blocksToFill = [];
                task.phase = 'finishing';
                return 'running';
            }
            return 'running';
        }

        const fillPos = task.blocksToFill[0]!;
        const block = bot.blockAt(fillPos);

        // Check if already filled
        if (block && block.name !== 'air' && block.name !== 'water' && block.name !== 'flowing_water') {
            task.blocksToFill.shift();
            task.progress++;
            return 'running';
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
            const checkPos = fillPos.plus(offset);
            const checkBlock = bot.blockAt(checkPos);
            if (checkBlock && checkBlock.boundingBox === 'block' &&
                checkBlock.name !== 'water' && checkBlock.name !== 'flowing_water') {
                referenceBlock = checkBlock;
                faceVector = offset.scaled(-1);
                break;
            }
        }

        if (!referenceBlock) {
            bb.log?.debug(`[Landscaper] No reference block to place dirt at ${fillPos.floored()}`);
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
                // Try placing anyway
            }
        }

        // Equip and place dirt
        const dirtToPlace = bot.inventory.items().find(i => i.name === 'dirt');
        if (!dirtToPlace) {
            task.blocksToFill.shift();
            return 'running';
        }

        try {
            await bot.equip(dirtToPlace, 'hand');
            await sleep(50);
            await bot.placeBlock(referenceBlock, faceVector!);
            bb.log?.debug(`[Landscaper] Placed dirt at ${fillPos.floored()}`);
            task.blocksToFill.shift();
            task.progress++;
            await sleep(100);
        } catch (error) {
            bb.log?.debug(`[Landscaper] Place dirt failed at ${fillPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
            task.blocksToFill.shift();
        }

        return 'running';
    }

    /**
     * Gather dirt from OUTSIDE the 9x9 work area.
     * Prefers: surface grass blocks, inland (away from water), close to bot.
     * Falls back to underground dirt if surface isn't available.
     */
    private async gatherDirtFromNearby(bot: Bot, bb: LandscaperBlackboard, task: TerraformTask): Promise<boolean> {
        const waterCenter = task.waterCenter;
        const targetY = task.targetY;
        const workRadius = 4; // The 9x9 work area
        const searchRadius = 24; // Larger search radius to find inland dirt

        interface DirtCandidate {
            pos: Vec3;
            isSurface: boolean;      // grass_block on top = surface
            distFromWater: number;   // prefer far from water (inland)
            distFromBot: number;
            isUnderground: boolean;  // below surface
        }

        const candidates: DirtCandidate[] = [];

        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                // Skip blocks INSIDE the work area
                if (Math.abs(dx) <= workRadius && Math.abs(dz) <= workRadius) continue;

                const x = Math.floor(waterCenter.x) + dx;
                const z = Math.floor(waterCenter.z) + dz;

                // Check surface first (grass blocks), then underground
                for (let dy = 4; dy >= -5; dy--) {
                    const pos = new Vec3(x, targetY + dy, z);
                    const block = bot.blockAt(pos);
                    const above = bot.blockAt(pos.offset(0, 1, 0));

                    if (!block) continue;

                    // Check if this is a valid dirt source
                    const isDirt = block.name === 'dirt' || block.name === 'grass_block';
                    if (!isDirt) continue;

                    // Check if it's a surface block (air or small plants above)
                    // Note: 'grass_block' is NOT a plant, it's solid ground
                    const isSurface = above && (
                        above.name === 'air' ||
                        above.name === 'short_grass' ||
                        above.name === 'tall_grass' ||
                        above.name.includes('flower') ||
                        above.name.includes('fern') ||
                        above.name === 'dead_bush'
                    );

                    // Calculate distance from water - skip only blocks VERY close to water (1 block)
                    // Underground blocks can be closer since digging them won't affect water flow
                    const minWaterDist = isSurface ? 2 : 1;
                    let nearWater = false;
                    for (let wx = -minWaterDist; wx <= minWaterDist && !nearWater; wx++) {
                        for (let wz = -minWaterDist; wz <= minWaterDist && !nearWater; wz++) {
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

                    // Check if this is underground (has solid block above)
                    const isUnderground = above && above.boundingBox === 'block' &&
                                          above.name !== 'grass_block' && above.name !== 'dirt';

                    candidates.push({
                        pos: pos.clone(),
                        isSurface: isSurface || false,
                        distFromWater: pos.distanceTo(waterCenter),
                        distFromBot: pos.distanceTo(bot.entity.position),
                        isUnderground: isUnderground || false
                    });

                    // Only take topmost block at each x,z for surface
                    if (isSurface) break;
                }
            }
        }

        if (candidates.length === 0) {
            // Last resort: try to find any dirt underground even further away
            bb.log?.debug(`[Landscaper] No dirt in primary search, trying extended underground search`);
            for (let dx = -32; dx <= 32; dx += 2) {
                for (let dz = -32; dz <= 32; dz += 2) {
                    if (Math.abs(dx) <= workRadius && Math.abs(dz) <= workRadius) continue;

                    const x = Math.floor(waterCenter.x) + dx;
                    const z = Math.floor(waterCenter.z) + dz;

                    // Check underground only
                    for (let dy = -2; dy >= -8; dy--) {
                        const pos = new Vec3(x, targetY + dy, z);
                        const block = bot.blockAt(pos);
                        if (!block) continue;

                        if (block.name === 'dirt') {
                            candidates.push({
                                pos: pos.clone(),
                                isSurface: false,
                                distFromWater: pos.distanceTo(waterCenter),
                                distFromBot: pos.distanceTo(bot.entity.position),
                                isUnderground: true
                            });
                        }
                    }
                }
            }
        }

        if (candidates.length === 0) {
            return false;
        }

        // Sort: surface blocks first, underground second, then by distance from water (far = better), then by bot distance
        candidates.sort((a, b) => {
            // Surface blocks are best (visible, easy access)
            if (a.isSurface !== b.isSurface) return a.isSurface ? -1 : 1;
            // Non-underground is better than underground
            if (a.isUnderground !== b.isUnderground) return a.isUnderground ? 1 : -1;
            // Prefer further from water (inland)
            if (Math.abs(a.distFromWater - b.distFromWater) > 3) {
                return b.distFromWater - a.distFromWater;
            }
            // Then by distance to bot
            return a.distFromBot - b.distFromBot;
        });

        const neededDirt = Math.min(task.blocksToFill.length, 16);
        let gathered = 0;

        const shovel = bot.inventory.items().find(i => i.name.includes('shovel'));
        if (shovel) {
            try {
                await bot.equip(shovel, 'hand');
            } catch (e) { /* continue */ }
        }

        for (const candidate of candidates) {
            if (gathered >= neededDirt) break;
            if (bb.inventoryFull) break;

            const block = bot.blockAt(candidate.pos);
            if (!block || (block.name !== 'dirt' && block.name !== 'grass_block')) continue;

            const dist = bot.entity.position.distanceTo(candidate.pos);
            if (dist > 4) {
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(candidate.pos.x, candidate.pos.y, candidate.pos.z, 3),
                    { timeoutMs: 15000 }
                );
                if (!result.success) continue;
            }

            try {
                await bot.dig(block);
                gathered++;
                const source = candidate.isSurface ? 'surface' : (candidate.isUnderground ? 'underground' : 'subsurface');
                bb.log?.debug(`[Landscaper] Gathered ${block.name} ${gathered}/${neededDirt} from ${candidate.pos.floored()} (${source})`);
                await sleep(100);
            } catch (error) {
                // Skip
            }
        }

        if (gathered > 0) {
            bb.log?.debug(`[Landscaper] Gathered ${gathered} dirt blocks`);
            return true;
        }

        return false;
    }

    /**
     * Clear and fill the 1-block path around the 9x9 farm.
     * This ensures bots can walk around the farm perimeter.
     */
    private async clearPath(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_clearing_path';

        // First, clear any obstacles above the path
        if (task.pathBlocksToClear.length > 0) {
            const clearPos = task.pathBlocksToClear[0]!;
            const block = bot.blockAt(clearPos);

            // Check if already cleared
            if (!block || block.name === 'air') {
                task.pathBlocksToClear.shift();
                task.progress++;
                return 'running';
            }

            // Check inventory - stop if full
            if (bb.inventoryFull) {
                bb.log?.debug(`[Landscaper] Inventory full during path clearing, pausing`);
                return 'failure'; // Let deposit action run
            }

            // Equip appropriate tool
            const needPickaxe = HARD_BLOCKS.includes(block.name);
            const toolType = needPickaxe ? 'pickaxe' : 'shovel';

            const tool = bot.inventory.items().find(i => i.name.includes(toolType));
            if (tool) {
                try {
                    await bot.equip(tool, 'hand');
                } catch (error) {
                    // Continue without tool
                }
            }

            // Move close to the block
            const dist = bot.entity.position.distanceTo(clearPos);
            if (dist > 4) {
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(clearPos.x, clearPos.y, clearPos.z, 3),
                    { timeoutMs: 15000 }
                );
                if (!result.success && dist > 6) {
                    task.pathBlocksToClear.shift(); // Skip unreachable
                    return 'running';
                }
            }

            // Dig the block
            try {
                await bot.dig(block);
                bb.log?.debug(`[Landscaper] Cleared path obstacle: ${block.name} at ${clearPos.floored()}`);
                task.pathBlocksToClear.shift();
                task.progress++;
                await sleep(100);
            } catch (error) {
                bb.log?.debug(`[Landscaper] Path clear failed at ${clearPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
                task.pathBlocksToClear.shift();
            }

            return 'running';
        }

        // Then, fill any holes in the path
        if (task.pathBlocksToFill.length > 0) {
            const fillPos = task.pathBlocksToFill[0]!;
            const block = bot.blockAt(fillPos);

            // Check if already filled
            if (block && block.name !== 'air' && block.name !== 'water' && block.name !== 'flowing_water') {
                task.pathBlocksToFill.shift();
                task.progress++;
                return 'running';
            }

            // Check if we have dirt
            const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');
            if (!dirtItem) {
                bb.log?.debug(`[Landscaper] Need dirt for path - gathering`);
                const gathered = await this.gatherDirtFromNearby(bot, bb, task);
                if (!gathered) {
                    bb.log?.debug(`[Landscaper] No dirt found for path - skipping remaining fills`);
                    task.pathBlocksToFill = [];
                    task.phase = 'finishing';
                    return 'running';
                }
                return 'running';
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
                const checkPos = fillPos.plus(offset);
                const checkBlock = bot.blockAt(checkPos);
                if (checkBlock && checkBlock.boundingBox === 'block' &&
                    checkBlock.name !== 'water' && checkBlock.name !== 'flowing_water') {
                    referenceBlock = checkBlock;
                    faceVector = offset.scaled(-1);
                    break;
                }
            }

            if (!referenceBlock) {
                bb.log?.debug(`[Landscaper] No reference block for path fill at ${fillPos.floored()}, skipping`);
                task.pathBlocksToFill.shift();
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
                    // Try placing anyway if somewhat close
                }
            }

            // Equip and place dirt
            const dirtToPlace = bot.inventory.items().find(i => i.name === 'dirt');
            if (!dirtToPlace) {
                task.pathBlocksToFill.shift();
                return 'running';
            }

            try {
                await bot.equip(dirtToPlace, 'hand');
                await sleep(50);
                await bot.placeBlock(referenceBlock, faceVector!);
                bb.log?.debug(`[Landscaper] Filled path at ${fillPos.floored()}`);
                task.pathBlocksToFill.shift();
                task.progress++;
                await sleep(100);
            } catch (error) {
                bb.log?.debug(`[Landscaper] Path fill failed at ${fillPos.floored()}: ${error instanceof Error ? error.message : 'unknown'}`);
                task.pathBlocksToFill.shift();
            }

            return 'running';
        }

        // Path complete, move to finishing
        bb.log?.debug(`[Landscaper] Path clearing complete`);
        task.phase = 'finishing';
        return 'running';
    }

    private async finishTask(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        const task = bb.currentTerraformTask!;
        bb.lastAction = 'terraform_done';

        // Announce completion at the water center position (matches request)
        if (bb.villageChat) {
            bb.villageChat.announceTerraformDone(task.waterCenter);
        }

        bb.log?.debug(`[Landscaper] Terraform complete - 9x9 farm with path at ${task.waterCenter.floored()}`);

        task.phase = 'done';
        bb.currentTerraformTask = null;

        return 'success';
    }
}
