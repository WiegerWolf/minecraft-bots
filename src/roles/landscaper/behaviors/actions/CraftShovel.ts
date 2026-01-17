import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalNear, GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CraftShovel - Craft a wooden or stone shovel
 */
export class CraftShovel implements BehaviorNode {
    name = 'CraftShovel';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // Already have a shovel
        if (bb.hasShovel) return 'failure';

        bb.lastAction = 'craft_shovel';

        // Try to craft stone shovel first if we have cobblestone
        if (bb.cobblestoneCount >= 1 && bb.stickCount >= 2) {
            const result = await this.craftShovelAtTable(bot, bb, 'stone_shovel');
            if (result === 'success') return 'success';
        }

        // Fall back to wooden shovel
        // First, ensure we have planks
        if (bb.plankCount < 1) {
            if (bb.logCount < 1) {
                console.log('[Landscaper] Need logs to craft planks for shovel');
                return 'failure';
            }

            const craftedPlanks = await this.craftPlanks(bot);
            if (!craftedPlanks) return 'failure';

            // Update counts
            bb.plankCount = bot.inventory.items()
                .filter(i => i.name.endsWith('_planks'))
                .reduce((s, i) => s + i.count, 0);
        }

        // Now ensure we have sticks
        if (bb.stickCount < 2) {
            if (bb.plankCount < 2) {
                console.log('[Landscaper] Need more planks for sticks');
                return 'failure';
            }

            const craftedSticks = await this.craftSticks(bot);
            if (!craftedSticks) return 'failure';

            bb.stickCount = bot.inventory.items()
                .filter(i => i.name === 'stick')
                .reduce((s, i) => s + i.count, 0);
        }

        // Check for cobblestone again after potential crafting
        const cobble = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((s, i) => s + i.count, 0);
        if (cobble >= 1) {
            const result = await this.craftShovelAtTable(bot, bb, 'stone_shovel');
            if (result === 'success') return 'success';
        }

        // Craft wooden shovel
        return this.craftShovelAtTable(bot, bb, 'wooden_shovel');
    }

    private async craftPlanks(bot: Bot): Promise<boolean> {
        try {
            const logItem = bot.inventory.items().find(i => i.name.includes('_log'));
            if (!logItem) return false;

            const plankName = logItem.name.replace('_log', '_planks');
            const plankId = bot.registry.itemsByName[plankName]?.id;
            if (!plankId) return false;

            const recipe = bot.recipesFor(plankId, null, 1, null)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1);
            console.log(`[Landscaper] Crafted planks`);
            await sleep(100);
            return true;
        } catch (error) {
            console.warn(`[Landscaper] Failed to craft planks:`, error);
            return false;
        }
    }

    private async craftSticks(bot: Bot): Promise<boolean> {
        try {
            const stickId = bot.registry.itemsByName['stick']?.id;
            if (!stickId) return false;

            const recipe = bot.recipesFor(stickId, null, 1, null)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1);
            console.log(`[Landscaper] Crafted sticks`);
            await sleep(100);
            return true;
        } catch (error) {
            console.warn(`[Landscaper] Failed to craft sticks:`, error);
            return false;
        }
    }

    private async findOrPlaceCraftingTable(bot: Bot, bb: LandscaperBlackboard): Promise<any | null> {
        // Look for existing crafting table nearby
        const tables = bot.findBlocks({
            matching: b => b.name === 'crafting_table',
            maxDistance: 32,
            count: 1
        });

        if (tables.length > 0) {
            const table = bot.blockAt(tables[0]!);
            if (table) return table;
        }

        // Check shared crafting table from village chat
        if (bb.sharedCraftingTable) {
            const table = bot.blockAt(bb.sharedCraftingTable);
            if (table && table.name === 'crafting_table') {
                return table;
            }
        }

        // Check if we have a crafting table in inventory
        let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

        if (!tableItem) {
            // Try to craft one (4 planks)
            if (bb.plankCount < 4) {
                console.log('[Landscaper] Not enough planks to craft crafting table');
                return null;
            }

            const tableId = bot.registry.itemsByName['crafting_table']?.id;
            if (!tableId) return null;

            const recipe = bot.recipesFor(tableId, null, 1, null)[0];
            if (!recipe) return null;

            try {
                await bot.craft(recipe, 1);
                console.log(`[Landscaper] Crafted crafting table`);
                await sleep(100);
            } catch (error) {
                console.warn(`[Landscaper] Failed to craft crafting table:`, error);
                return null;
            }
        }

        // Place the crafting table
        tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
        if (!tableItem) return null;

        // Find a spot to place it
        const searchCenter = bb.villageCenter || bot.entity.position;
        const groundBlocks = bot.findBlocks({
            point: searchCenter,
            matching: b => ['grass_block', 'dirt', 'stone', 'cobblestone', 'sand', 'gravel'].includes(b.name),
            maxDistance: 8,
            count: 20
        });

        groundBlocks.sort((a, b) =>
            a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)
        );

        for (const groundPos of groundBlocks) {
            const placePos = groundPos.offset(0, 1, 0);
            const above = bot.blockAt(placePos);
            if (above && above.name === 'air') {
                const groundBlock = bot.blockAt(groundPos);
                if (!groundBlock || groundBlock.boundingBox !== 'block') continue;

                try {
                    const moveResult = await smartPathfinderGoto(
                        bot,
                        new GoalNear(placePos.x, placePos.y, placePos.z, 3),
                        { timeoutMs: 15000 }
                    );
                    if (!moveResult.success) continue;
                    await sleep(100);

                    await bot.equip(tableItem, 'hand');
                    await sleep(50);

                    await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                    console.log(`[Landscaper] Placed crafting table at ${placePos}`);
                    await sleep(200);

                    const placedTable = bot.blockAt(placePos);
                    if (placedTable && placedTable.name === 'crafting_table') {
                        if (bb.villageChat) {
                            bb.villageChat.announceSharedCraftingTable(placePos);
                            bb.sharedCraftingTable = placePos;
                        }
                        return placedTable;
                    }
                } catch (error) {
                    console.warn(`[Landscaper] Failed to place crafting table:`, error);
                }
            }
        }

        return null;
    }

    private async craftShovelAtTable(bot: Bot, bb: LandscaperBlackboard, shovelType: string): Promise<BehaviorStatus> {
        const craftingTable = await this.findOrPlaceCraftingTable(bot, bb);
        if (!craftingTable) {
            console.log('[Landscaper] Cannot craft shovel - no crafting table');
            return 'failure';
        }

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalLookAtBlock(craftingTable.position, bot.world, { reach: 4 }),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                console.log(`[Landscaper] Failed to reach crafting table: ${result.failureReason}`);
                return 'failure';
            }

            const shovelId = bot.registry.itemsByName[shovelType]?.id;
            if (!shovelId) {
                console.log(`[Landscaper] Cannot find ${shovelType} in registry`);
                return 'failure';
            }

            const recipe = bot.recipesFor(shovelId, null, 1, craftingTable)[0];
            if (!recipe) {
                console.log(`[Landscaper] No recipe found for ${shovelType}`);
                return 'failure';
            }

            await bot.craft(recipe, 1, craftingTable);
            console.log(`[Landscaper] Crafted ${shovelType}!`);
            return 'success';
        } catch (error) {
            console.warn(`[Landscaper] Failed to craft shovel:`, error);
            return 'failure';
        }
    }
}
