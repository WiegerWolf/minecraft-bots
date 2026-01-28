import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { GoalNear, GoalGetToBlock } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { sleep, pathfinderGotoWithRetry, isPathfinderTimeoutError } from '../../../../shared/PathfindingUtils';

/**
 * Sets up a chest near the farm for storing harvest.
 * - Finds existing chest near farm
 * - Or crafts and places a new one
 */
export class SetupFarmChest implements BehaviorNode {
    name = 'SetupFarmChest';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // If we have a shared chest from village chat, use that
        if (bb.sharedChest) {
            const block = bot.blockAt(bb.sharedChest);
            if (block && block.name === 'chest') {
                // Also set as farmChest for compatibility
                bb.farmChest = bb.sharedChest;
                return 'failure';  // Already have a shared chest, let other actions run
            }
            // Shared chest no longer exists
            bb.sharedChest = null;
        }

        // Already have a farm chest
        if (bb.farmChest) {
            // Verify it still exists
            const block = bot.blockAt(bb.farmChest);
            if (block && block.name === 'chest') {
                return 'failure';  // Already set up, let other actions run
            }
            // Chest was destroyed, clear it
            bb.farmChest = null;
        }

        if (!bb.farmCenter) return 'failure';

        // Look for existing chest near farm
        const existingChest = this.findNearbyChest(bot, bb.farmCenter);
        if (existingChest) {
            bb.farmChest = existingChest.position.clone();
            // Announce as shared chest
            if (bb.villageChat) {
                bb.villageChat.announceSharedChest(bb.farmChest);
                bb.sharedChest = bb.farmChest;
            }
            bb.log?.debug(`[BT] Found existing farm chest at ${bb.farmChest}`);
            return 'success';
        }

        // Need to place a chest - check if we have one in inventory
        const chestItem = bot.inventory.items().find(i => i.name === 'chest');
        if (chestItem) {
            return await this.placeChest(bot, bb);
        }

        // Need to craft a chest (requires 8 planks)
        return await this.craftChest(bot, bb);
    }

    private findNearbyChest(bot: Bot, farmCenter: Vec3): { position: Vec3 } | null {
        const chests = bot.findBlocks({
            point: farmCenter,
            maxDistance: 16,
            count: 5,
            matching: b => b?.name === 'chest'
        });

        const firstChest = chests[0];
        if (firstChest) {
            const block = bot.blockAt(firstChest);
            if (block) return { position: block.position };
        }
        return null;
    }

    private async placeChest(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        const farmCenter = bb.farmCenter!;

        // Place chest on the path ring (radius 5 from center)
        // The 9x9 farm has radius 4, and the landscaper clears a 1-block path at radius 5
        // Prefer corners for better accessibility and to avoid blocking the path
        const pathRadius = 5;
        const placements = [
            // Corners first (less likely to block walking path)
            farmCenter.offset(pathRadius, 0, pathRadius),
            farmCenter.offset(-pathRadius, 0, pathRadius),
            farmCenter.offset(pathRadius, 0, -pathRadius),
            farmCenter.offset(-pathRadius, 0, -pathRadius),
            // Then cardinal directions
            farmCenter.offset(pathRadius, 0, 0),
            farmCenter.offset(-pathRadius, 0, 0),
            farmCenter.offset(0, 0, pathRadius),
            farmCenter.offset(0, 0, -pathRadius),
        ];

        for (const pos of placements) {
            const block = bot.blockAt(pos);
            const above = bot.blockAt(pos.offset(0, 1, 0));

            // Need solid ground with air above
            if (!block || !above) continue;
            if (block.name === 'air' || block.name === 'water') continue;
            if (above.name !== 'air') continue;

            // Place chest on top of this block
            const chestPos = pos.offset(0, 1, 0);
            bb.log?.debug(`[BT] Placing farm chest at ${chestPos}`);
            bb.lastAction = 'place_chest';

            try {
                const success = await pathfinderGotoWithRetry(bot, new GoalNear(pos.x, pos.y, pos.z, 3));
                if (!success) {
                    bb.log?.debug(`[BT] Failed to reach chest placement position after retries`);
                    continue;
                }
                bot.pathfinder.stop();

                const chestItem = bot.inventory.items().find(i => i.name === 'chest');
                if (!chestItem) return 'failure';

                await bot.equip(chestItem, 'hand');
                await bot.lookAt(pos.offset(0.5, 1, 0.5), true);
                await bot.placeBlock(block, new Vec3(0, 1, 0));
                await sleep(300);

                bb.farmChest = chestPos;
                bb.log?.debug(`[BT] Farm chest placed at ${bb.farmChest}`);

                // Announce to village chat that we have a shared chest
                if (bb.villageChat) {
                    bb.villageChat.announceSharedChest(chestPos);
                    bb.sharedChest = chestPos;
                }

                return 'success';
            } catch (err) {
                bb.log?.debug(`[BT] Failed to place chest: ${err}`);
            }
        }

        return 'failure';
    }

    private async craftChest(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        const inv = bot.inventory.items();
        const plankCount = inv.filter(i => i.name.endsWith('_planks')).reduce((s, i) => s + i.count, 0);
        const logCount = inv.filter(i => i.name.includes('_log')).reduce((s, i) => s + i.count, 0);

        // Need 8 planks for a chest (2 logs = 8 planks)
        if (plankCount >= 8) {
            // Craft chest at crafting table
            return await this.craftChestAtTable(bot, bb);
        }

        if (logCount >= 2) {
            // Convert logs to planks first
            bb.log?.debug(`[BT] Converting logs to planks for chest...`);
            bb.lastAction = 'craft_planks';
            try {
                const logItem = inv.find(i => i.name.includes('_log'));
                if (!logItem) return 'failure';

                const plankName = logItem.name.replace('_log', '_planks');
                const plankId = bot.registry.itemsByName[plankName]?.id;
                if (!plankId) return 'failure';

                const recipe = bot.recipesFor(plankId, null, 1, null)[0];
                if (recipe) {
                    await bot.craft(recipe, 2);  // 2 logs = 8 planks
                    return 'success';  // Will craft chest next tick
                }
            } catch (err) {
                bb.log?.debug(`[BT] Failed to craft planks: ${err}`);
            }
            return 'failure';
        }

        // Need more logs - gather wood ourselves
        bb.log?.debug(`[BT] Need 2 logs to craft chest, gathering wood...`);
        bb.lastAction = 'gather_wood_for_chest';
        return await this.gatherWoodForChest(bot);
    }

    private async gatherWoodForChest(bot: Bot): Promise<BehaviorStatus> {
        // Find a tree/log nearby
        const logs = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 64, // Increased range for navigation
            count: 10,
            matching: b => b?.name?.includes('_log') ?? false
        });

        if (logs.length === 0) {
            return 'failure';
        }

        const logPos = logs[0];
        if (!logPos) return 'failure';

        const block = bot.blockAt(logPos);
        if (!block) return 'failure';

        try {
            const success = await pathfinderGotoWithRetry(bot, new GoalGetToBlock(logPos.x, logPos.y, logPos.z));
            if (!success) {
                return 'failure';
            }
            await bot.dig(block);
            await sleep(300);
            return 'success';
        } catch {
            return 'failure';
        }
    }

    private async craftChestAtTable(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        bb.log?.debug(`[BT] Crafting chest...`);
        bb.lastAction = 'craft_chest';

        // Find or place a crafting table
        let craftingTable: any = null;

        // Try shared crafting table first
        if (bb.sharedCraftingTable) {
            const tableBlock = bot.blockAt(bb.sharedCraftingTable);
            if (tableBlock && tableBlock.name === 'crafting_table') {
                craftingTable = bb.sharedCraftingTable;
            }
        }

        // If no shared crafting table, look for nearby one
        if (!craftingTable) {
            const craftingTables = bot.findBlocks({
                point: bot.entity.position,
                maxDistance: 64, // Increased range for navigation
                count: 1,
                matching: b => b?.name === 'crafting_table'
            });
            craftingTable = craftingTables[0];
        }

        if (!craftingTable) {
            // Need to place a crafting table first
            let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
            if (!tableItem) {
                // Craft a crafting table (4 planks)
                try {
                    const plankItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
                    if (!plankItem) return 'failure';

                    const tableId = bot.registry.itemsByName['crafting_table']?.id;
                    if (!tableId) return 'failure';

                    const tableRecipe = bot.recipesFor(tableId, null, 1, null)[0];
                    if (tableRecipe) {
                        await bot.craft(tableRecipe, 1);
                        tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
                    }
                } catch (err) {
                    bb.log?.debug(`[BT] Failed to craft crafting table: ${err}`);
                    return 'failure';
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
                                bb.log?.debug(`[BT] Placed crafting table at ${placePos}`);
                                craftingTable = placePos;
                                break;
                            }
                        } catch (err) {
                            bb.log?.debug(`[BT] Failed to place crafting table: ${err}`);
                        }
                    }
                }
            }

            if (!craftingTable) {
                bb.log?.debug(`[BT] No crafting table available and failed to place one`);
                return 'failure';
            }
        }

        // Use crafting table to make chest
        try {
            const tableBlock = bot.blockAt(craftingTable);
            if (!tableBlock) return 'failure';

            const success = await pathfinderGotoWithRetry(bot, new GoalGetToBlock(craftingTable.x, craftingTable.y, craftingTable.z));
            if (!success) {
                bb.log?.debug(`[BT] Failed to reach crafting table for chest after retries`);
                return 'failure';
            }

            const chestId = bot.registry.itemsByName['chest']?.id;
            if (!chestId) return 'failure';

            const chestRecipe = bot.recipesFor(chestId, null, 1, tableBlock)[0];
            if (!chestRecipe) {
                bb.log?.debug(`[BT] No chest recipe found at crafting table`);
                return 'failure';
            }

            await bot.craft(chestRecipe, 1, tableBlock);
            bb.log?.debug(`[BT] Successfully crafted chest!`);
            return 'success';
        } catch (err) {
            bb.log?.debug(`[BT] Failed to craft chest: ${err}`);
            return 'failure';
        }
    }
}
