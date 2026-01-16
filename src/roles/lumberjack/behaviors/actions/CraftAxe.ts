import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear, GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CraftAxe - Craft a wooden axe if we have materials
 */
export class CraftAxe implements BehaviorNode {
    name = 'CraftAxe';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Already have an axe
        if (bb.hasAxe) return 'failure';

        bb.lastAction = 'craft_axe';

        // First, ensure we have planks
        if (bb.plankCount < 3) {
            // Try to craft planks from logs
            if (bb.logCount < 1) {
                console.log('[Lumberjack] Need logs to craft planks for axe');
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
                console.log('[Lumberjack] Need more planks for sticks');
                return 'failure';
            }

            const craftedSticks = await this.craftSticks(bot);
            if (!craftedSticks) return 'failure';

            // Update counts
            bb.stickCount = bot.inventory.items()
                .filter(i => i.name === 'stick')
                .reduce((s, i) => s + i.count, 0);
        }

        // Check if we need a crafting table (wooden axe requires 3x3)
        const needsCraftingTable = true; // Axe requires 3x3 grid

        if (needsCraftingTable) {
            // Find or place crafting table
            const craftingTable = await this.findOrPlaceCraftingTable(bot, bb);
            if (!craftingTable) {
                console.log('[Lumberjack] Cannot craft axe - no crafting table');
                return 'failure';
            }

            // Craft the axe at the crafting table
            return this.craftAxeAtTable(bot, craftingTable);
        }

        return 'failure';
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
            console.log(`[Lumberjack] Crafted planks`);
            await sleep(100);
            return true;
        } catch (error) {
            console.warn(`[Lumberjack] Failed to craft planks:`, error);
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
            console.log(`[Lumberjack] Crafted sticks`);
            await sleep(100);
            return true;
        } catch (error) {
            console.warn(`[Lumberjack] Failed to craft sticks:`, error);
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
        const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

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
            } catch (error) {
                console.warn(`[Lumberjack] Failed to craft crafting table:`, error);
                return null;
            }
        }

        // Place the crafting table
        const newTableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
        if (!newTableItem) return null;

        // Find a spot to place it
        const groundBlocks = bot.findBlocks({
            matching: b => ['grass_block', 'dirt', 'stone', 'cobblestone'].includes(b.name),
            maxDistance: 5,
            count: 10
        });

        for (const groundPos of groundBlocks) {
            const above = bot.blockAt(groundPos.offset(0, 1, 0));
            if (above && above.name === 'air') {
                try {
                    await bot.equip(newTableItem, 'hand');
                    const groundBlock = bot.blockAt(groundPos);
                    if (groundBlock) {
                        await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                        console.log(`[Lumberjack] Placed crafting table at ${groundPos.offset(0, 1, 0)}`);
                        await sleep(200);
                        return bot.blockAt(groundPos.offset(0, 1, 0));
                    }
                } catch (error) {
                    console.warn(`[Lumberjack] Failed to place crafting table:`, error);
                }
            }
        }

        return null;
    }

    private async craftAxeAtTable(bot: Bot, craftingTable: any): Promise<BehaviorStatus> {
        try {
            // Move to crafting table
            await bot.pathfinder.goto(new GoalLookAtBlock(craftingTable.position, bot.world, { reach: 4 }));

            // Get wooden axe recipe
            const axeId = bot.registry.itemsByName['wooden_axe']?.id;
            if (!axeId) {
                console.log('[Lumberjack] Cannot find wooden axe in registry');
                return 'failure';
            }

            const recipe = bot.recipesFor(axeId, null, 1, craftingTable)[0];
            if (!recipe) {
                console.log('[Lumberjack] No recipe found for wooden axe');
                return 'failure';
            }

            await bot.craft(recipe, 1, craftingTable);
            console.log(`[Lumberjack] Crafted wooden axe!`);
            return 'success';
        } catch (error) {
            console.warn(`[Lumberjack] Failed to craft axe:`, error);
            return 'failure';
        }
    }
}
