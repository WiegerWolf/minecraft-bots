import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { GoalNear } from 'baritone-ts';

/**
 * CraftSlabs - Craft wooden slabs for pathfinding scaffolding.
 *
 * Wooden slabs are used by the pathfinder for pillaring and bridging.
 * They're ideal because they're easy to break and don't waste dirt.
 * Recipe: 3 planks -> 6 slabs (at crafting table)
 */
export class CraftSlabs implements BehaviorNode {
    name = 'CraftSlabs';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        bb.lastAction = 'craft_slabs';

        // Need at least 3 planks to craft slabs
        if (bb.plankCount < 3) {
            bb.log?.debug('[Landscaper] Not enough planks to craft slabs');
            return 'failure';
        }

        // Find a crafting table
        let craftingTable = bb.sharedCraftingTable
            ? bot.blockAt(bb.sharedCraftingTable)
            : null;

        if (!craftingTable && bb.nearbyCraftingTables.length > 0) {
            craftingTable = bb.nearbyCraftingTables[0]!;
        }

        if (!craftingTable) {
            bb.log?.debug('[Landscaper] No crafting table available for slab crafting');
            return 'failure';
        }

        // Move to crafting table
        const dist = bot.entity.position.distanceTo(craftingTable.position);
        if (dist > 4) {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                bb.log?.warn('[Landscaper] Failed to reach crafting table for slabs');
                return 'failure';
            }
        }

        // Find planks in inventory
        const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
        if (!planks) {
            return 'failure';
        }

        // Determine slab type based on plank type
        const woodType = planks.name.replace('_planks', '');
        const slabName = `${woodType}_slab`;

        try {
            // Get the recipe for slabs
            const mcData = require('minecraft-data')(bot.version);
            const slabItem = mcData.itemsByName[slabName];
            if (!slabItem) {
                bb.log?.warn({ slabName }, '[Landscaper] Unknown slab type');
                return 'failure';
            }

            // Craft slabs (3 planks -> 6 slabs)
            const recipes = bot.recipesFor(slabItem.id, null, 1, craftingTable);
            if (recipes.length === 0) {
                bb.log?.debug('[Landscaper] No recipe found for slabs');
                return 'failure';
            }

            // Craft one batch (uses 3 planks, makes 6 slabs)
            await bot.craft(recipes[0]!, 1, craftingTable);
            bb.log?.info({ slabName, count: 6 }, '[Landscaper] Crafted wooden slabs');

            return 'success';
        } catch (error) {
            bb.log?.warn({ error: error instanceof Error ? error.message : 'unknown' }, '[Landscaper] Failed to craft slabs');
            return 'failure';
        }
    }
}
