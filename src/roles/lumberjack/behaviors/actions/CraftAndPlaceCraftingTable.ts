import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalLookAtBlock, GoalNear } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * CraftAndPlaceCraftingTable - Craft a crafting table if needed and place it at village center
 */
export class CraftAndPlaceCraftingTable implements BehaviorNode {
    name = 'CraftAndPlaceCraftingTable';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // If there's already a shared crafting table available, don't craft/place
        if (bb.sharedCraftingTable !== null || bb.nearbyCraftingTables.length > 0) {
            return 'failure';
        }

        // Establish village center at current position if not set
        if (!bb.villageCenter) {
            const pos = bot.entity.position.floored();
            bb.villageCenter = pos;
            bb.log?.debug(`[Lumberjack] Establishing village center at ${pos}`);
            if (bb.villageChat) {
                bb.villageChat.announceVillageCenter(pos);
            }

            // Queue sign write for village center
            if (bb.spawnPosition) {
                bb.pendingSignWrites.push({
                    type: 'VILLAGE',
                    pos: pos.clone()
                });
                bb.log?.debug({ type: 'VILLAGE', pos: pos.toString() }, 'Queued sign write for village center');
            }
        }

        // Check if we have materials (4 planks)
        if (bb.plankCount < 4) {
            // Try to craft more planks if we have logs
            if (bb.logCount < 1) {
                bb.log?.debug('[Lumberjack] Need more logs to craft planks for crafting table');
                return 'failure';
            }

            const craftedPlanks = await this.craftPlanks(bot, bb);
            if (!craftedPlanks) return 'failure';
        }

        bb.log?.debug('[Lumberjack] Crafting and placing crafting table at village center...');
        bb.lastAction = 'craft_crafting_table';

        // Craft crafting table
        const crafted = await this.craftCraftingTable(bot);
        if (!crafted) {
            bb.log?.debug('[Lumberjack] Cannot craft crafting table');
            return 'failure';
        }

        // Place at village center
        const placed = await this.placeCraftingTableAtVillageCenter(bot, bb);
        if (placed) {
            bb.log?.debug(`[Lumberjack] Crafting table placed at ${bb.sharedCraftingTable}`);

            // Queue sign write for persistent knowledge
            // Cast is needed because TypeScript narrowed sharedCraftingTable to null
            // after the early return, but placeCraftingTableAtVillageCenter sets it
            const craftingTablePos = bb.sharedCraftingTable as Vec3 | null;
            if (craftingTablePos && bb.spawnPosition) {
                bb.pendingSignWrites.push({
                    type: 'CRAFT',
                    pos: craftingTablePos.clone()
                });
                bb.log?.debug({ type: 'CRAFT', pos: craftingTablePos.toString() }, 'Queued sign write for crafting table');
            }

            return 'success';
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

            // Craft 1 log to get 4 planks
            await bot.craft(recipe, 1);
            bb.log?.debug(`[Lumberjack] Crafted planks for crafting table`);
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
            bb.log?.warn({ err: error }, 'Failed to craft planks');
            return false;
        }
    }

    private async craftCraftingTable(bot: Bot): Promise<boolean> {
        try {
            const tableId = bot.registry.itemsByName['crafting_table']?.id;
            if (!tableId) return false;

            const recipe = bot.recipesFor(tableId, null, 1, null)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1);
            await sleep(100);
            return true;
        } catch {
            return false;
        }
    }

    private async placeCraftingTableAtVillageCenter(bot: Bot, bb: LumberjackBlackboard): Promise<boolean> {
        const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
        if (!tableItem) return false;

        // Find suitable spot near village center (1 block away from center)
        const placements = [
            bb.villageCenter!.offset(1, 0, 0),
            bb.villageCenter!.offset(-1, 0, 0),
            bb.villageCenter!.offset(0, 0, 1),
            bb.villageCenter!.offset(0, 0, -1),
            bb.villageCenter!.offset(1, 0, 1),
            bb.villageCenter!.offset(-1, 0, -1),
            bb.villageCenter!.offset(1, 0, -1),
            bb.villageCenter!.offset(-1, 0, 1)
        ];

        for (const placePos of placements) {
            const groundBlock = bot.blockAt(placePos.offset(0, -1, 0));
            const targetBlock = bot.blockAt(placePos);

            if (groundBlock && groundBlock.boundingBox === 'block' && targetBlock && targetBlock.name === 'air') {
                try {
                    const moveResult = await smartPathfinderGoto(
                        bot,
                        new GoalNear(placePos.x, placePos.y, placePos.z, 3),
                        { timeoutMs: 15000 }
                    );
                    if (!moveResult.success) continue;
                    await bot.equip(tableItem, 'hand');
                    await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
                    await sleep(200);
                    const placedTable = bot.blockAt(placePos);

                    if (placedTable && placedTable.name === 'crafting_table') {
                        // Announce to village
                        if (bb.villageChat) {
                            bb.villageChat.announceSharedCraftingTable(placePos);
                            bb.sharedCraftingTable = placePos;
                        }
                        return true;
                    }
                } catch (error) {
                    bb.log?.warn({ err: error }, 'Failed to place crafting table');
                }
            }
        }

        return false;
    }
}
