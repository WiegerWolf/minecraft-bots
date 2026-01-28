import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { GoalGetToBlock, GoalNear } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Blocks suitable for village center (natural surface blocks)
const VALID_SURFACE_BLOCKS = [
    'grass_block', 'dirt', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt',
    'sand', 'red_sand', 'gravel', 'clay', 'moss_block',
    'stone', 'deepslate', 'andesite', 'diorite', 'granite',
];

/**
 * Check if a position is suitable for establishing a village center.
 * Requirements:
 * 1. Standing on a valid surface block (grass, dirt, stone, etc.)
 * 2. Enough open space around (not in a 1-block wide hole)
 * 3. Has sky access or is in an open area (not deep underground)
 */
function isValidVillageCenterPosition(bot: Bot, pos: Vec3): boolean {
    const groundBlock = bot.blockAt(pos.offset(0, -1, 0));
    const feetBlock = bot.blockAt(pos);
    const headBlock = bot.blockAt(pos.offset(0, 1, 0));

    // Must be standing on valid surface
    if (!groundBlock || !VALID_SURFACE_BLOCKS.includes(groundBlock.name)) {
        return false;
    }

    // Must have air at feet and head level
    if (!feetBlock || feetBlock.name !== 'air') return false;
    if (!headBlock || headBlock.name !== 'air') return false;

    // Check for open space around (at least 2 of 4 cardinal directions should be open)
    const cardinalOffsets = [
        new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    ];

    let openSides = 0;
    for (const offset of cardinalOffsets) {
        const checkPos = pos.plus(offset);
        const blockAtFeet = bot.blockAt(checkPos);
        const blockAtHead = bot.blockAt(checkPos.offset(0, 1, 0));

        if (blockAtFeet?.name === 'air' && blockAtHead?.name === 'air') {
            openSides++;
        }
    }

    if (openSides < 2) {
        return false; // Too enclosed (in a hole or corridor)
    }

    // Check for sky access (or at least not deep underground)
    // Look up to 10 blocks above - should find air or leaves
    let skyAccess = true;
    for (let dy = 2; dy <= 10; dy++) {
        const above = bot.blockAt(pos.offset(0, dy, 0));
        if (!above) break;
        if (above.name !== 'air' && !above.name.includes('leaves')) {
            // Check if it's solid - if so, we're underground
            if (above.boundingBox === 'block') {
                skyAccess = false;
                break;
            }
        }
    }

    // If no sky access, check if we're on grass (grass needs light to survive)
    // If grass block exists, we're probably not underground
    if (!skyAccess && groundBlock.name !== 'grass_block') {
        return false;
    }

    return true;
}

/**
 * Find a valid village center position near the current location.
 * Searches in an expanding spiral pattern.
 */
function findValidVillageCenterNearby(bot: Bot, startPos: Vec3, maxRadius: number = 10): Vec3 | null {
    // First check current position
    if (isValidVillageCenterPosition(bot, startPos)) {
        return startPos.clone();
    }

    // Search in expanding squares
    for (let radius = 1; radius <= maxRadius; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                // Only check perimeter of the square at this radius
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                const checkPos = startPos.offset(dx, 0, dz).floored();
                if (isValidVillageCenterPosition(bot, checkPos)) {
                    return checkPos;
                }
            }
        }
    }

    return null;
}

/**
 * CraftAndPlaceCraftingTable - Craft a crafting table if needed and place it at village center
 *
 * IMPORTANT: Village center must be on a proper surface (grass/dirt),
 * with open space around, not in a hole or underground.
 */
export class CraftAndPlaceCraftingTable implements BehaviorNode {
    name = 'CraftAndPlaceCraftingTable';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // If there's already a shared crafting table available, don't craft/place
        if (bb.sharedCraftingTable !== null || bb.nearbyCraftingTables.length > 0) {
            return 'failure';
        }

        // Establish village center at a valid position if not set
        if (!bb.villageCenter) {
            const currentPos = bot.entity.position.floored();
            const validPos = findValidVillageCenterNearby(bot, currentPos);

            if (!validPos) {
                bb.log?.debug('Cannot find valid surface for village center - need open area on grass/dirt');
                return 'failure';
            }

            bb.villageCenter = validPos;
            bb.log?.info({ pos: validPos.toString() }, 'Establishing village center at valid surface location');
            if (bb.villageChat) {
                bb.villageChat.announceVillageCenter(validPos);
            }

            // Queue sign write for village center
            if (bb.spawnPosition) {
                bb.pendingSignWrites.push({
                    type: 'VILLAGE',
                    pos: validPos.clone()
                });
                bb.log?.debug({ type: 'VILLAGE', pos: validPos.toString() }, 'Queued sign write for village center');
            }
        }

        // Check if we have materials (4 planks)
        if (bb.plankCount < 4) {
            // Try to craft more planks if we have logs
            if (bb.logCount < 1) {
                bb.log?.debug('[Lumberjack] Need more logs to craft planks for crafting table');
                return 'failure';
            }

            const craftedPlanks = await this.craftPlanks(bot, bb);
            if (!craftedPlanks) return 'failure';
        }

        bb.log?.debug('[Lumberjack] Crafting and placing crafting table at village center...');
        bb.lastAction = 'craft_crafting_table';

        // Craft crafting table
        const crafted = await this.craftCraftingTable(bot);
        if (!crafted) {
            bb.log?.debug('[Lumberjack] Cannot craft crafting table');
            return 'failure';
        }

        // Place at village center
        const placed = await this.placeCraftingTableAtVillageCenter(bot, bb);
        if (placed) {
            bb.log?.debug(`[Lumberjack] Crafting table placed at ${bb.sharedCraftingTable}`);

            // Queue sign write for persistent knowledge
            // Cast is needed because TypeScript narrowed sharedCraftingTable to null
            // after the early return, but placeCraftingTableAtVillageCenter sets it
            const craftingTablePos = bb.sharedCraftingTable as Vec3 | null;
            if (craftingTablePos && bb.spawnPosition) {
                bb.pendingSignWrites.push({
                    type: 'CRAFT',
                    pos: craftingTablePos.clone()
                });
                bb.log?.debug({ type: 'CRAFT', pos: craftingTablePos.toString() }, 'Queued sign write for crafting table');
            }

            return 'success';
        }

        return 'failure';
    }

    private async craftPlanks(bot: Bot, bb: LumberjackBlackboard): Promise<boolean> {
        try {
            const logItem = bot.inventory.items().find(i => i.name.includes('_log'));
            if (!logItem) return false;

            const plankName = logItem.name.replace('_log', '_planks');
            const plankId = bot.registry.itemsByName[plankName]?.id;
            if (!plankId) return false;

            const recipe = bot.recipesFor(plankId, null, 1, null)[0];
            if (!recipe) return false;

            // Craft 1 log to get 4 planks
            await bot.craft(recipe, 1);
            bb.log?.debug(`[Lumberjack] Crafted planks for crafting table`);
            await sleep(100);

            // Update counts
            bb.plankCount = bot.inventory.items()
                .filter(i => i.name.endsWith('_planks'))
                .reduce((s, i) => s + i.count, 0);

            bb.logCount = bot.inventory.items()
                .filter(i => i.name.includes('_log'))
                .reduce((s, i) => s + i.count, 0);

            return true;
        } catch (error) {
            bb.log?.warn({ err: error }, 'Failed to craft planks');
            return false;
        }
    }

    private async craftCraftingTable(bot: Bot): Promise<boolean> {
        try {
            const tableId = bot.registry.itemsByName['crafting_table']?.id;
            if (!tableId) return false;

            const recipe = bot.recipesFor(tableId, null, 1, null)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1);
            await sleep(100);
            return true;
        } catch {
            return false;
        }
    }

    private async placeCraftingTableAtVillageCenter(bot: Bot, bb: LumberjackBlackboard): Promise<boolean> {
        const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
        if (!tableItem) return false;

        // Find suitable spot near village center (1 block away from center)
        // Must be on valid surface, not in a hole
        const placements = [
            bb.villageCenter!.offset(1, 0, 0),
            bb.villageCenter!.offset(-1, 0, 0),
            bb.villageCenter!.offset(0, 0, 1),
            bb.villageCenter!.offset(0, 0, -1),
            bb.villageCenter!.offset(1, 0, 1),
            bb.villageCenter!.offset(-1, 0, -1),
            bb.villageCenter!.offset(1, 0, -1),
            bb.villageCenter!.offset(-1, 0, 1)
        ];

        for (const placePos of placements) {
            const groundBlock = bot.blockAt(placePos.offset(0, -1, 0));
            const targetBlock = bot.blockAt(placePos);
            const aboveTarget = bot.blockAt(placePos.offset(0, 1, 0));

            // Must have solid ground, air at target, and air above (so bots can use it)
            if (!groundBlock || groundBlock.boundingBox !== 'block') continue;
            if (!targetBlock || targetBlock.name !== 'air') continue;
            if (!aboveTarget || aboveTarget.name !== 'air') continue;

            // Prefer valid surface blocks (grass, dirt, stone) over random blocks
            const isGoodSurface = VALID_SURFACE_BLOCKS.includes(groundBlock.name);
            if (!isGoodSurface) {
                bb.log?.debug({ groundBlock: groundBlock.name, pos: placePos.toString() }, 'Skipping placement on non-surface block');
                continue;
            }

            try {
                const moveResult = await smartPathfinderGoto(
                    bot,
                    new GoalNear(placePos.x, placePos.y, placePos.z, 3),
                    { timeoutMs: 15000 }
                );
                if (!moveResult.success) continue;
                await bot.equip(tableItem, 'hand');
                await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                await sleep(200);
                const placedTable = bot.blockAt(placePos);

                if (placedTable && placedTable.name === 'crafting_table') {
                    // Announce to village
                    if (bb.villageChat) {
                        bb.villageChat.announceSharedCraftingTable(placePos);
                        bb.sharedCraftingTable = placePos;
                    }
                    bb.log?.info({ pos: placePos.toString() }, 'Placed crafting table at village center');
                    return true;
                }
            } catch (error) {
                bb.log?.warn({ err: error }, 'Failed to place crafting table');
            }
        }

        return false;
    }
}
