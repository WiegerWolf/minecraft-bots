import type { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { smartPathfinderGoto } from '../../shared/PathfindingUtils';

const { GoalNear } = goals;

export type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Mixin that adds crafting capabilities to a Role.
 */
export function CraftingMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        protected craftingItem: string | null = null;
        protected lastRequestTime: number = 0;

        protected findCraftingTable(bot: Bot) {
            if ((this as any).getNearestPOI) {
                const poi = (this as any).getNearestPOI(bot, 'crafting_table');
                if (poi) {
                    const block = bot.blockAt(poi.position);
                    if (block && block.name === 'crafting_table') {
                        return block;
                    } else {
                        if ((this as any).forgetPOI) (this as any).forgetPOI('crafting_table', poi.position);
                    }
                }
            }

            return bot.findBlock({
                matching: (block) => block.name === 'crafting_table',
                maxDistance: 32
            });
        }

        public async tryCraft(bot: Bot, itemName: string, onTargetSet?: (target: any) => void) {
            const mcData = minecraftData(bot.version);
            const item = mcData.itemsByName[itemName];
            if (!item) {
                // this.log(`Unknown item: ${itemName}`);
                return false;
            }

            // 1. Always check if we can craft in 2x2 first (Inventory only)
            const recipes2x2 = bot.recipesFor(item.id, null, 1, null);
            if (recipes2x2.length > 0) {
                try {
                    // this.log(`Crafting ${itemName} using 2x2 inventory recipe...`);
                    // FIX: Ensure recipe exists
                    const recipe2x2 = recipes2x2[0];
                    if (recipe2x2) {
                        await bot.craft(recipe2x2, 1, undefined);
                        return true;
                    }
                } catch (err) {
                    // this.log(`Failed to craft 2x2: ${err}`);
                }
            }

            // 2. Find a crafting table
            let craftingTable = this.findCraftingTable(bot);

            // Remember it
            if (craftingTable && (this as any).rememberPOI) {
                (this as any).rememberPOI('crafting_table', craftingTable.position);
            }

            // If no table found, try to create one
            if (!craftingTable) {
                const tableBlock = mcData.blocksByName.crafting_table;
                if (tableBlock) {
                    const Block = prismarineBlock(bot.version);
                    const fakeTable = new Block(tableBlock.id, 0, 0);
                    // Check if the recipe actually needs a table
                    const recipes3x3 = bot.recipesFor(item.id, null, 1, fakeTable);

                    if (recipes3x3.length > 0) {
                        const tableInInventory = bot.inventory.items().find(i => i.name === 'crafting_table');
                        if (tableInInventory) {
                            if (await this.placeCraftingTable(bot)) {
                                await new Promise(resolve => setTimeout(resolve, 500));
                                craftingTable = this.findCraftingTable(bot);
                            }
                        } else {
                            // this.log('No table found or in inventory. Trying to craft one.');
                            const tableItemData = mcData.itemsByName['crafting_table'];
                            if (tableItemData) {
                                const tableRecipes = bot.recipesFor(tableItemData.id, null, 1, null);
                                if (tableRecipes.length > 0) {
                                    // this.log('Crafting a crafting table...');
                                    // FIX: Ensure recipe exists
                                    const tableRecipe = tableRecipes[0];
                                    if (tableRecipe) {
                                        await bot.craft(tableRecipe, 1, undefined);
                                        if (await this.placeCraftingTable(bot)) {
                                            await new Promise(resolve => setTimeout(resolve, 500));
                                            craftingTable = this.findCraftingTable(bot);
                                        }
                                    }
                                } else {
                                     // this.log('Have materials for 3x3 item, but cannot make table (no wood?).');
                                }
                            }
                        }
                    }
                }
            }

            if (!craftingTable) {
                return false;
            }

            // Check if valid recipe exists for this table
            const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
            if (recipes.length === 0) {
                // this.log(`Cannot craft ${itemName} even with table.`);
                return false;
            }

            // 3. Move to table and Craft
            this.craftingItem = itemName;
            const dist = bot.entity.position.distanceTo(craftingTable.position);
            
            if (dist > 3) {
                // this.log(`Moving to crafting table at ${craftingTable.position} to craft ${itemName}...`);
                if (onTargetSet) onTargetSet(craftingTable);

                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 2),
                    { timeoutMs: 15000 }
                );
                if (!result.success) {
                    // this.log("Movement to crafting table failed or interrupted.");
                    return false;
                }
            }

            if (bot.entity.position.distanceTo(craftingTable.position) <= 4) {
                 const recipe = recipes[0];
                 if (recipe) {
                     // this.log(`Executing craft for ${itemName}...`);
                     try {
                        await bot.craft(recipe, 1, craftingTable);
                        // this.log(`✅ Successfully crafted ${itemName}.`);
                        this.craftingItem = null;
                        return true;
                     } catch (err) {
                        // this.log(`❌ Crafting failed: ${err}`);
                        return false;
                     }
                 }
            }
            
            return false;
        }

        protected async placeCraftingTable(bot: Bot): Promise<boolean> {
            // this.log('Attempting to place crafting table...');
            const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
            if (!tableItem) {
                // this.log('❌ Placement failed: No crafting table item in inventory.');
                return false;
            }

            const botPos = bot.entity.position.floored();
            const offsets = [
                new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
                new Vec3(0, 0, 1), new Vec3(0, 0, -1),
                new Vec3(1, 0, 1), new Vec3(-1, 0, -1),
                new Vec3(1, 0, -1), new Vec3(-1, 0, 1)
            ];

            for (const offset of offsets) {
                const targetPos = botPos.plus(offset);
                if (bot.entity.position.distanceTo(targetPos.offset(0.5, 0, 0.5)) < 0.8) continue;

                const block = bot.blockAt(targetPos);
                const blockBelow = bot.blockAt(targetPos.offset(0, -1, 0));

                if (block && (block.name === 'air' || block.name === 'grass' || block.name === 'tall_grass') &&
                    blockBelow && blockBelow.name !== 'air' && blockBelow.name !== 'water' && blockBelow.name !== 'lava') {
                    try {
                        // this.log(`Placing crafting table on ${blockBelow.name} at ${targetPos}...`);
                        await bot.equip(tableItem, 'hand');
                        await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
                        // this.log(`✅ Placed crafting table at ${targetPos}`);
                        if ((this as any).rememberPOI) {
                            (this as any).rememberPOI('crafting_table', targetPos);
                        }
                        return true;
                    } catch (err) {
                        // this.log(`⚠️ Failed to place table at ${targetPos}: ${err}`);
                    }
                }
            }
            // this.log('❌ Could not find a suitable spot to place crafting table.');
            return false;
        }
    };
}