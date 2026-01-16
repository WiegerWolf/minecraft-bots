import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CraftChest - Craft a chest if we have materials and no chest available
 */
export class CraftChest implements BehaviorNode {
    name = 'CraftChest';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // If there's already a chest available, don't craft
        if (bb.sharedChest !== null || bb.nearbyChests.length > 0) {
            return 'failure';
        }

        // Check if we have materials (8 planks)
        if (bb.plankCount < 8) {
            // Try to craft more planks if we have logs
            if (bb.logCount < 2) {
                console.log('[Lumberjack] Need more logs to craft planks for chest');
                return 'failure';
            }

            const craftedPlanks = await this.craftPlanks(bot, bb);
            if (!craftedPlanks) return 'failure';
        }

        console.log('[Lumberjack] Crafting chest...');
        bb.lastAction = 'craft_chest';

        // Find or place a crafting table
        const craftingTable = await this.findOrPlaceCraftingTable(bot, bb);
        if (!craftingTable) {
            console.log('[Lumberjack] Cannot craft chest - no crafting table');
            return 'failure';
        }

        // Craft the chest
        return await this.craftChestAtTable(bot, craftingTable);
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

            // Craft 2 logs to get 8 planks (1 log = 4 planks)
            await bot.craft(recipe, 2);
            console.log(`[Lumberjack] Crafted planks for chest`);
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
            console.warn(`[Lumberjack] Failed to craft planks:`, error);
            return false;
        }
    }

    private async findOrPlaceCraftingTable(bot: Bot, bb: LumberjackBlackboard): Promise<any | null> {
        // Look for existing crafting table nearby
        const tables = bot.findBlocks({
            matching: b => b.name === 'crafting_table',
            maxDistance: 32,
            count: 1
        });

        if (tables.length > 0) {
            const table = bot.blockAt(tables[0]!);
            if (table) {
                return table;
            }
        }

        // Check if we have a crafting table in inventory
        let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

        if (!tableItem) {
            // Try to craft one (4 planks)
            if (bb.plankCount < 4) {
                console.log('[Lumberjack] Not enough planks to craft crafting table');
                return null;
            }

            const tableId = bot.registry.itemsByName['crafting_table']?.id;
            if (!tableId) return null;

            const recipe = bot.recipesFor(tableId, null, 1, null)[0];
            if (!recipe) return null;

            try {
                await bot.craft(recipe, 1);
                console.log(`[Lumberjack] Crafted crafting table`);
                await sleep(100);
                tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
            } catch (error) {
                console.warn(`[Lumberjack] Failed to craft crafting table:`, error);
                return null;
            }
        }

        if (tableItem) {
            // Place the crafting table
            const pos = bot.entity.position.floored();
            for (const offset of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
                const placePos = pos.plus(offset);
                const groundBlock = bot.blockAt(placePos.offset(0, -1, 0));
                const targetBlock = bot.blockAt(placePos);

                if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                    try {
                        await bot.equip(tableItem, 'hand');
                        await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                        await sleep(200);
                        const placedTable = bot.blockAt(placePos);
                        if (placedTable && placedTable.name === 'crafting_table') {
                            console.log(`[Lumberjack] Placed crafting table at ${placePos}`);
                            return placedTable;
                        }
                    } catch (error) {
                        console.warn(`[Lumberjack] Failed to place crafting table:`, error);
                    }
                }
            }
        }

        return null;
    }

    private async craftChestAtTable(bot: Bot, craftingTable: any): Promise<BehaviorStatus> {
        try {
            // Move to crafting table
            await bot.pathfinder.goto(new GoalLookAtBlock(craftingTable.position, bot.world, { reach: 4 }));

            // Get chest recipe
            const chestId = bot.registry.itemsByName['chest']?.id;
            if (!chestId) {
                console.log('[Lumberjack] Cannot find chest in registry');
                return 'failure';
            }

            const recipe = bot.recipesFor(chestId, null, 1, craftingTable)[0];
            if (!recipe) {
                console.log('[Lumberjack] No recipe found for chest');
                return 'failure';
            }

            await bot.craft(recipe, 1, craftingTable);
            console.log(`[Lumberjack] Crafted chest!`);
            return 'success';
        } catch (error) {
            console.warn(`[Lumberjack] Failed to craft chest:`, error);
            return 'failure';
        }
    }
}
