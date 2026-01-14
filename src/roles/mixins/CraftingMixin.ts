import type { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
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

        protected canCraft(bot: Bot, itemName: string): boolean {
            const mcData = minecraftData(bot.version);
            const item = mcData.itemsByName[itemName];
            if (!item) return false;

            // Check 2x2 first
            let recipes = bot.recipesFor(item.id, null, 1, null);
            if (recipes.length > 0) return true;

            // Check 3x3 if a table is nearby
            const craftingTable = this.findCraftingTable(bot);
            if (craftingTable) {
                recipes = bot.recipesFor(item.id, null, 1, craftingTable);
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
            if (!item) return;

            // Find a crafting table nearby
            const craftingTable = this.findCraftingTable(bot);

            const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
            if (recipes.length === 0) {
                // Check if we can craft it in 2x2
                const recipes2x2 = bot.recipesFor(item.id, null, 1, null);
                if (recipes2x2.length > 0) {
                    try {
                        bot.chat(`Crafting ${itemName}...`);
                        const recipe2x2 = recipes2x2[0];
                        if (recipe2x2) {
                            await bot.craft(recipe2x2, 1, undefined);
                        }
                        return true;
                    } catch (err) {
                        console.error('Crafting 2x2 failed:', err);
                    }
                }
                return false;
            }

            if (craftingTable) {
                this.craftingItem = itemName;
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
                await bot.craft(recipe, 1, block.name === 'crafting_table' ? block : undefined);
                this.craftingItem = null;
                return true;
            }

            this.craftingItem = null; // Clear if we couldn't craft
            return false;
        }
    };
}
