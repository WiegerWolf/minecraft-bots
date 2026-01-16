import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear, GoalLookAtBlock } = goals;

/**
 * Sets up a chest near the farm for storing harvest.
 * - Finds existing chest near farm
 * - Or crafts and places a new one
 */
export class SetupFarmChest implements BehaviorNode {
    name = 'SetupFarmChest';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
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
            console.log(`[BT] Found existing farm chest at ${bb.farmChest}`);
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

        // Find a spot just outside the farm (6 blocks from center)
        const placements = [
            farmCenter.offset(6, 0, 0),
            farmCenter.offset(-6, 0, 0),
            farmCenter.offset(0, 0, 6),
            farmCenter.offset(0, 0, -6),
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
            console.log(`[BT] Placing farm chest at ${chestPos}`);
            bb.lastAction = 'place_chest';

            try {
                await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 3));
                bot.pathfinder.stop();

                const chestItem = bot.inventory.items().find(i => i.name === 'chest');
                if (!chestItem) return 'failure';

                await bot.equip(chestItem, 'hand');
                await bot.lookAt(pos.offset(0.5, 1, 0.5), true);
                await bot.placeBlock(block, new Vec3(0, 1, 0));
                await sleep(300);

                bb.farmChest = chestPos;
                console.log(`[BT] Farm chest placed at ${bb.farmChest}`);
                return 'success';
            } catch (err) {
                console.log(`[BT] Failed to place chest: ${err}`);
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
            console.log(`[BT] Converting logs to planks for chest...`);
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
                console.log(`[BT] Failed to craft planks: ${err}`);
            }
            return 'failure';
        }

        // Need more logs - gather wood ourselves
        console.log(`[BT] Need 2 logs to craft chest, gathering wood...`);
        bb.lastAction = 'gather_wood_for_chest';
        return await this.gatherWoodForChest(bot);
    }

    private async gatherWoodForChest(bot: Bot): Promise<BehaviorStatus> {
        // Find a tree/log nearby
        const logs = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 32,
            count: 10,
            matching: b => b?.name?.includes('_log') ?? false
        });

        if (logs.length === 0) {
            console.log(`[BT] No logs found nearby for chest`);
            return 'failure';
        }

        const logPos = logs[0];
        if (!logPos) return 'failure';

        const block = bot.blockAt(logPos);
        if (!block) return 'failure';

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(logPos, bot.world));
            await bot.dig(block);
            await sleep(300);
            console.log(`[BT] Gathered log for chest`);
            return 'success';
        } catch (err) {
            console.log(`[BT] Failed to gather wood: ${err}`);
            return 'failure';
        }
    }

    private async craftChestAtTable(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        console.log(`[BT] Crafting chest...`);
        bb.lastAction = 'craft_chest';

        // Find or place a crafting table
        const craftingTables = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 32,
            count: 1,
            matching: b => b?.name === 'crafting_table'
        });
        const craftingTable = craftingTables[0];

        if (!craftingTable) {
            // Need to place a crafting table first
            const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
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
                    }
                } catch (err) {
                    console.log(`[BT] Failed to craft crafting table: ${err}`);
                    return 'failure';
                }
            }
            return 'success';  // Will place table next tick
        }

        // Use crafting table to make chest
        try {
            const tableBlock = bot.blockAt(craftingTable);
            if (!tableBlock) return 'failure';

            await bot.pathfinder.goto(new GoalLookAtBlock(craftingTable, bot.world));

            const chestId = bot.registry.itemsByName['chest']?.id;
            if (!chestId) return 'failure';

            const chestRecipe = bot.recipesFor(chestId, null, 1, tableBlock)[0];
            if (!chestRecipe) {
                console.log(`[BT] No chest recipe found at crafting table`);
                return 'failure';
            }

            await bot.craft(chestRecipe, 1, tableBlock);
            console.log(`[BT] Successfully crafted chest!`);
            return 'success';
        } catch (err) {
            console.log(`[BT] Failed to craft chest: ${err}`);
            return 'failure';
        }
    }
}
