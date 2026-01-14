import type { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
const minecraftData = require('minecraft-data');

const { GoalNear } = goals;

export type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Mixin that adds crafting capabilities to a Role.
 */
export function CraftingMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        protected craftingItem: string | null = null;
        protected lastRequestTime: number = 0;

        protected log(message: string, ...args: any[]) {
            console.log(`[Crafting] ${message}`, ...args);
        }

        protected canCraft(bot: Bot, itemName: string): boolean {
            const mcData = minecraftData(bot.version);
            const item = mcData.itemsByName[itemName];
            if (!item) {
                // this.log(`canCraft: Unknown item ${itemName}`);
                return false;
            }

            // 1. Check if we can craft it in 2x2
            let recipes = bot.recipesFor(item.id, null, 1, null);
            if (recipes.length > 0) return true;

            // 2. Check 3x3 if we have a table nearby, in inventory, or can make one
            const tableNearby = this.findCraftingTable(bot);
            const hasTableInInv = !!bot.inventory.items().find(i => i.name === 'crafting_table');

            const tableItem = mcData.itemsByName['crafting_table'];
            const canMakeTable = bot.recipesFor(tableItem.id, null, 1, null).length > 0;

            if (tableNearby || hasTableInInv || canMakeTable) {
                // If we could have a table, check if the recipe is possible in 3x3
                // We simulate a table by creating a fake block instance
                const Block = require('prismarine-block')(bot.version);
                const fakeTable = new Block(mcData.blocksByName.crafting_table.id, 0, 0);
                recipes = bot.recipesFor(item.id, null, 1, fakeTable);
                return recipes.length > 0;
            }

            return false;
        }

        protected findCraftingTable(bot: Bot) {
            return bot.findBlock({
                matching: (block) => block.name === 'crafting_table',
                maxDistance: 20
            });
        }

        protected async tryCraft(bot: Bot, itemName: string, onTargetSet?: (target: any) => void) {
            const mcData = minecraftData(bot.version);
            const item = mcData.itemsByName[itemName];
            if (!item) {
                this.log(`Unknown item: ${itemName}`);
                return false;
            }

            this.log(`Trying to craft ${itemName}...`);

            // Find a crafting table nearby
            let craftingTable = this.findCraftingTable(bot);
            if (craftingTable) this.log(`Found existing crafting table at ${craftingTable.position}`);

            // If no crafting table nearby, check if we need one (3x3 recipe)
            const recipes = bot.recipesFor(item.id, null, 1, craftingTable);

            // Fix: If we have a recipe and don't need a table (or found one), but craftingTable is null (meaning it's a 2x2 recipe), do it.
            if (!craftingTable && recipes.length > 0) {
                this.log(`Crafting ${itemName} using 2x2 inventory recipe...`);
                try {
                    const recipe = recipes[0];
                    if (recipe) {
                        await bot.craft(recipe, 1, undefined);
                        return true;
                    }
                } catch (err) {
                    console.error('Crafting 2x2 failed:', err);
                    this.log(`Failed to craft 2x2: ${err}`);
                    return false;
                }
            }

            if (recipes.length === 0) {
                this.log(`No recipe found for ${itemName} with current table/inventory. Checking 2x2...`);
                // Check if we can craft it in 2x2
                const recipes2x2 = bot.recipesFor(item.id, null, 1, null);
                if (recipes2x2.length > 0) {
                    try {
                        bot.chat(`Crafting ${itemName}...`);
                        this.log(`Crafting ${itemName} using 2x2 recipe.`);
                        const recipe2x2 = recipes2x2[0];
                        if (recipe2x2) {
                            await bot.craft(recipe2x2, 1, undefined);
                        }
                        return true;
                    } catch (err) {
                        console.error('Crafting 2x2 failed:', err);
                        this.log(`Failed to craft 2x2: ${err}`);
                    }
                }

                // If it needs 3x3 but no table is nearby, try to get a table
                if (!craftingTable) {
                    const tableInInventory = bot.inventory.items().find(i => i.name === 'crafting_table');
                    if (tableInInventory) {
                        const success = await this.placeCraftingTable(bot);
                        if (success) {
                            // Find the newly placed table
                            craftingTable = this.findCraftingTable(bot);
                        }
                    } else {
                        // Try to craft a table in 2x2
                        this.log('No table found or in inventory. Trying to craft one.');
                        const tableItem = mcData.itemsByName['crafting_table'];
                        const tableRecipes = bot.recipesFor(tableItem.id, null, 1, null);
                        const tableRecipe = tableRecipes[0];
                        if (tableRecipe) {
                            bot.chat('I need a crafting table, making one...');
                            this.log('Crafting a crafting table...');
                            await bot.craft(tableRecipe, 1, undefined);
                            const success = await this.placeCraftingTable(bot);
                            if (success) {
                                craftingTable = this.findCraftingTable(bot);
                            }
                        }
                    }
                }

                // Try again with the potential new table
                const recipesAfterTable = bot.recipesFor(item.id, null, 1, craftingTable);
                if (recipesAfterTable.length === 0) {
                    if (Date.now() - this.lastRequestTime > 30000) {
                        bot.chat(`I have materials for ${itemName}, but I can't find or make a crafting table!`);
                        this.lastRequestTime = Date.now();
                    }
                    return false;
                }
                this.log(`Recipe found using table.`);
            }

            if (craftingTable) {
                this.craftingItem = itemName;
                this.log(`Setting target to crafting table at ${craftingTable.position} to craft ${itemName}`);
                if (onTargetSet) {
                    onTargetSet(craftingTable);
                }
                bot.pathfinder.setGoal(new GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 1));
                return true;
            } else {
                if (Date.now() - this.lastRequestTime > 30000) {
                    bot.chat(`I have materials for ${itemName}, but I can't find a crafting table!`);
                    this.lastRequestTime = Date.now();
                }
                return false;
            }
        }

        protected async placeCraftingTable(bot: Bot): Promise<boolean> {
            this.log('Attempting to place crafting table...');
            const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
            if (!tableItem) {
                this.log('No crafting table item in inventory to place.');
                return false;
            }

            // Find a place to put it
            const pos = bot.entity.position.floored();
            const offsets = [
                new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
                new Vec3(0, 0, 1), new Vec3(0, 0, -1)
            ];

            for (const offset of offsets) {
                const targetPos = pos.plus(offset);
                const block = bot.blockAt(targetPos);
                const blockBelow = bot.blockAt(targetPos.offset(0, -1, 0));

                if (block && block.name === 'air' && blockBelow && blockBelow.name !== 'air' && blockBelow.name !== 'water' && blockBelow.name !== 'lava') {
                    try {
                        await bot.equip(tableItem, 'hand');
                        await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
                        this.log(`Placed crafting table at ${targetPos}`);
                        return true;
                    } catch (err) {
                        console.error('Failed to place crafting table:', err);
                        this.log(`Failed to place table at ${targetPos}: ${err}`);
                    }
                }
            }
            return false;
        }

        protected async performCraftingAction(bot: Bot, block: any): Promise<boolean> {
            if (!this.craftingItem) return false;

            const mcData = minecraftData(bot.version);
            const item = mcData.itemsByName[this.craftingItem];
            if (!item) {
                this.craftingItem = null;
                return false;
            }

            const recipes = bot.recipesFor(item.id, null, 1, block.name === 'crafting_table' ? block : null);
            const recipe = recipes[0];
            if (recipe) {
                bot.chat(`Crafting ${this.craftingItem}...`);
                this.log(`Executing craft for ${this.craftingItem}...`);
                await bot.craft(recipe, 1, block.name === 'crafting_table' ? block : undefined);
                this.craftingItem = null;
                return true;
            }

            this.craftingItem = null; // Clear if we couldn't craft
            return false;
        }
    };
}
