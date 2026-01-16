import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalLookAtBlock, GoalNear } = goals;

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

        // Need village center to know where to place
        if (!bb.villageCenter) {
            console.log('[Lumberjack] Need village center to place chest');
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
        const crafted = await this.craftChestAtTable(bot, craftingTable);
        if (crafted === 'success') {
            // Place the chest at village center
            const placed = await this.placeChestAtVillageCenter(bot, bb);
            if (placed) {
                console.log(`[Lumberjack] Chest placed at ${bb.sharedChest}`);
                return 'success';
            }
            return 'failure';
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
        if (bb.sharedCraftingTable) {
            const table = bot.blockAt(bb.sharedCraftingTable);
            if (table && table.name === 'crafting_table') {
                return table;
            }
        }

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
            let placePos: Vec3;
            if (bb.villageCenter) {
                // Place near village center if available
                const placements = [
                    bb.villageCenter.offset(2, 0, 0),
                    bb.villageCenter.offset(-2, 0, 0),
                    bb.villageCenter.offset(0, 0, 2),
                    bb.villageCenter.offset(0, 0, -2)
                ];

                for (const pos of placements) {
                    const groundBlock = bot.blockAt(pos.offset(0, -1, 0));
                    const targetBlock = bot.blockAt(pos);

                    if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                        placePos = pos;
                        try {
                            await bot.equip(tableItem, 'hand');
                            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                            await sleep(200);
                            const placedTable = bot.blockAt(placePos);
                            if (placedTable && placedTable.name === 'crafting_table') {
                                console.log(`[Lumberjack] Placed crafting table at ${placePos}`);
                                if (bb.villageChat) {
                                    bb.villageChat.announceSharedCraftingTable(placePos);
                                    bb.sharedCraftingTable = placePos;
                                }
                                return placedTable;
                            }
                        } catch (error) {
                            console.warn(`[Lumberjack] Failed to place crafting table:`, error);
                        }
                    }
                }
            }

            // Fallback to placing near current position
            const pos = bot.entity.position.floored();
            for (const offset of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
                const fallbackPos = pos.plus(offset);
                const groundBlock = bot.blockAt(fallbackPos.offset(0, -1, 0));
                const targetBlock = bot.blockAt(fallbackPos);

                if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                    try {
                        await bot.equip(tableItem, 'hand');
                        await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                        await sleep(200);
                        const placedTable = bot.blockAt(fallbackPos);
                        if (placedTable && placedTable.name === 'crafting_table') {
                            console.log(`[Lumberjack] Placed crafting table at ${fallbackPos}`);
                            if (bb.villageChat && bb.villageCenter) {
                                bb.villageChat.announceSharedCraftingTable(fallbackPos);
                                bb.sharedCraftingTable = fallbackPos;
                            }
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

    private async placeChestAtVillageCenter(bot: Bot, bb: LumberjackBlackboard): Promise<boolean> {
        const chestItem = bot.inventory.items().find(i => i.name === 'chest');
        if (!chestItem) return false;

        // Find suitable spot near village center (2 blocks away from center, adjacent to crafting table)
        const placements = [
            bb.villageCenter!.offset(2, 0, 1),
            bb.villageCenter!.offset(-2, 0, 1),
            bb.villageCenter!.offset(1, 0, 2),
            bb.villageCenter!.offset(1, 0, -2)
        ];

        for (const placePos of placements) {
            const groundBlock = bot.blockAt(placePos.offset(0, -1, 0));
            const targetBlock = bot.blockAt(placePos);

            if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                try {
                    await bot.pathfinder.goto(new GoalNear(placePos.x, placePos.y, placePos.z, 3));
                    await bot.equip(chestItem, 'hand');
                    await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                    await sleep(200);
                    const placedChest = bot.blockAt(placePos);

                    if (placedChest && placedChest.name === 'chest') {
                        // Announce to village
                        if (bb.villageChat) {
                            bb.villageChat.announceSharedChest(placePos);
                            bb.sharedChest = placePos;
                        }
                        return true;
                    }
                } catch (error) {
                    console.warn(`[Lumberjack] Failed to place chest:`, error);
                }
            }
        }

        // Fallback to placing near village center
        for (let x = -3; x <= 3; x++) {
            for (let z = -3; z <= 3; z++) {
                if (x === 0 && z === 0) continue;
                const placePos = bb.villageCenter!.offset(x, 0, z);
                const groundBlock = bot.blockAt(placePos.offset(0, -1, 0));
                const targetBlock = bot.blockAt(placePos);

                if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                    try {
                        await bot.pathfinder.goto(new GoalNear(placePos.x, placePos.y, placePos.z, 3));
                        await bot.equip(chestItem, 'hand');
                        await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                        await sleep(200);
                        const placedChest = bot.blockAt(placePos);

                        if (placedChest && placedChest.name === 'chest') {
                            if (bb.villageChat) {
                                bb.villageChat.announceSharedChest(placePos);
                                bb.sharedChest = placePos;
                            }
                            return true;
                        }
                    } catch (error) {
                        console.warn(`[Lumberjack] Failed to place chest:`, error);
                    }
                }
            }
        }

        return false;
    }
}
