import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear } = goals;

/**
 * Find or place a crafting table and return it
 */
async function ensureCraftingTable(bot: Bot): Promise<Block | null> {
    const craftingTableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

    // Look for existing crafting table nearby
    const nearbyTables = bot.findBlocks({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32,
        count: 1
    });

    if (nearbyTables.length > 0) {
        const tablePos = nearbyTables[0];
        if (tablePos) {
            const tableBlock = bot.blockAt(tablePos);
            if (tableBlock) {
                await bot.pathfinder.goto(new GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2));
                return tableBlock;
            }
        }
    }

    // If we have a crafting table item, place it
    if (craftingTableItem) {
        const pos = bot.entity.position.floored();
        for (const offset of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
            const placePos = pos.plus(offset);
            const groundBlock = bot.blockAt(placePos.offset(0, -1, 0));
            const targetBlock = bot.blockAt(placePos);

            if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                try {
                    await bot.equip(craftingTableItem, 'hand');
                    await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                    await sleep(200);
                    const placedTable = bot.blockAt(placePos);
                    if (placedTable && placedTable.name === 'crafting_table') {
                        console.log(`[BT] Placed crafting table at ${placePos}`);
                        return placedTable;
                    }
                } catch (err) {
                    console.log(`[BT] Failed to place crafting table: ${err}`);
                }
            }
        }
    }

    return null;
}

export class CraftHoe implements BehaviorNode {
    name = 'CraftHoe';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.hasHoe) return 'failure';

        // Step 1: Convert logs to planks (2x2 recipe, no table needed)
        if (bb.logCount > 0 && bb.plankCount < 4) {
            console.log(`[BT] Converting logs to planks...`);
            const log = bot.inventory.items().find(i => i.name.includes('_log'));
            if (log) {
                const plankName = log.name.replace('_log', '_planks');
                const plankItem = bot.registry.itemsByName[plankName] || bot.registry.itemsByName['oak_planks'];
                if (plankItem) {
                    const recipes = bot.recipesFor(plankItem.id, null, 1, null);
                    const recipe = recipes[0];
                    if (recipe) {
                        try {
                            await bot.craft(recipe, 1);
                            return 'running';
                        } catch (err) {
                            console.log(`[BT] Failed to craft planks: ${err}`);
                        }
                    }
                }
            }
            return 'failure';
        }

        // Step 2: Craft crafting table if we don't have one nearby (2x2 recipe)
        if (bb.plankCount >= 4) {
            const existingTable = bot.findBlocks({
                matching: b => b.name === 'crafting_table',
                maxDistance: 32,
                count: 1
            });
            const hasTableItem = bot.inventory.items().some(i => i.name === 'crafting_table');

            if (existingTable.length === 0 && !hasTableItem) {
                console.log(`[BT] Crafting crafting table...`);
                const tableItem = bot.registry.itemsByName['crafting_table'];
                if (tableItem) {
                    const recipes = bot.recipesFor(tableItem.id, null, 1, null);
                    const recipe = recipes[0];
                    if (recipe) {
                        try {
                            await bot.craft(recipe, 1);
                            return 'running';
                        } catch (err) {
                            console.log(`[BT] Failed to craft crafting table: ${err}`);
                        }
                    }
                }
                return 'failure';
            }
        }

        // Step 3: Craft sticks if needed (2x2 recipe, no table needed)
        if (bb.plankCount >= 2 && bb.stickCount < 2) {
            console.log(`[BT] Crafting sticks...`);
            const stickItem = bot.registry.itemsByName['stick'];
            if (stickItem) {
                const recipes = bot.recipesFor(stickItem.id, null, 1, null);
                const recipe = recipes[0];
                if (recipe) {
                    try {
                        await bot.craft(recipe, 1);
                        return 'running';
                    } catch (err) {
                        console.log(`[BT] Failed to craft sticks: ${err}`);
                    }
                }
            }
            return 'failure';
        }

        // Step 4: Craft wooden hoe (requires 3x3 crafting table!)
        if (bb.plankCount >= 2 && bb.stickCount >= 2) {
            console.log(`[BT] Crafting wooden hoe...`);
            bb.lastAction = 'craft_hoe';

            const craftingTable = await ensureCraftingTable(bot);
            if (!craftingTable) {
                console.log(`[BT] No crafting table available`);
                return 'failure';
            }

            const hoeItem = bot.registry.itemsByName['wooden_hoe'];
            if (!hoeItem) return 'failure';

            const recipes = bot.recipesFor(hoeItem.id, null, 1, craftingTable);
            const recipe = recipes[0];
            if (!recipe) {
                console.log(`[BT] No recipe found for wooden hoe`);
                return 'failure';
            }

            try {
                await bot.craft(recipe, 1, craftingTable);
                console.log(`[BT] Successfully crafted wooden hoe!`);
                return 'success';
            } catch (err) {
                console.log(`[BT] Failed to craft hoe: ${err}`);
                return 'failure';
            }
        }

        return 'failure';
    }
}
