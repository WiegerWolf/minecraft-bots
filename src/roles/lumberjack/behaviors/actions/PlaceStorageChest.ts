import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { GoalNear } from 'baritone-ts';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

// Blocks suitable for placing a chest on (natural surface blocks)
const VALID_SURFACE_BLOCKS = [
    'grass_block', 'dirt', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt',
    'sand', 'red_sand', 'gravel', 'clay', 'moss_block',
    'stone', 'deepslate', 'andesite', 'diorite', 'granite',
];

/**
 * PlaceStorageChest - Place a chest near the village center for shared storage
 *
 * IMPORTANT: We place our own chest rather than adopting found chests.
 * Found chests (like nether portal ruins) are often underground or inaccessible.
 *
 * Requirements for chest placement:
 * 1. Near village center (within 5 blocks)
 * 2. On a valid surface (grass, dirt, stone)
 * 3. Has air above (accessible)
 * 4. Not in a hole or underground
 */
export class PlaceStorageChest implements BehaviorNode {
    name = 'PlaceStorageChest';

    private isChestFull(bb: LumberjackBlackboard, pos: Vec3): boolean {
        const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        const expiry = bb.fullChests.get(key);
        if (!expiry) return false;
        if (Date.now() >= expiry) {
            bb.fullChests.delete(key);
            return false;
        }
        return true;
    }

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Already have a non-full shared chest - no need to place another
        if (bb.sharedChest !== null && !this.isChestFull(bb, bb.sharedChest)) {
            return 'failure';
        }

        // Need village center first
        if (!bb.villageCenter) {
            bb.log?.debug('Cannot place chest without village center');
            return 'failure';
        }

        // Check if we have a chest in inventory
        const chestItem = bot.inventory.items().find(i => i.name === 'chest');
        if (!chestItem) {
            // Check if we can craft a chest (need 8 planks)
            if (bb.plankCount >= 8) {
                const crafted = await this.craftChest(bot, bb);
                if (!crafted) return 'failure';
            } else {
                bb.log?.debug('Need 8 planks to craft a chest');
                return 'failure';
            }
        }

        bb.lastAction = 'place_storage_chest';

        // Find a good spot near village center
        const placePos = this.findChestPlacement(bot, bb.villageCenter);
        if (!placePos) {
            bb.log?.debug('Cannot find suitable location for chest near village center');
            return 'failure';
        }

        // Place the chest
        const placed = await this.placeChest(bot, bb, placePos);
        if (placed) {
            bb.sharedChest = placePos;
            bb.knownChests.push(placePos.clone());

            // We placed this chest, so we know it's empty - no need to check for supplies
            bb.hasCheckedStorage = true;

            // Announce to village
            if (bb.villageChat) {
                bb.villageChat.announceSharedChest(placePos);
            }

            // Queue sign write
            if (bb.spawnPosition) {
                bb.pendingSignWrites.push({
                    type: 'CHEST',
                    pos: placePos.clone()
                });
            }

            bb.log?.info({ pos: placePos.toString() }, 'Placed storage chest at village center');
            return 'success';
        }

        return 'failure';
    }

    private async craftChest(bot: Bot, bb: LumberjackBlackboard): Promise<boolean> {
        try {
            const chestId = bot.registry.itemsByName['chest']?.id;
            if (!chestId) return false;

            // Need crafting table for chest (3x3 recipe)
            if (!bb.sharedCraftingTable && bb.nearbyCraftingTables.length === 0) {
                bb.log?.debug('Need crafting table to craft chest');
                return false;
            }

            const craftingTable = bb.sharedCraftingTable
                ? bot.blockAt(bb.sharedCraftingTable)
                : bb.nearbyCraftingTables[0];

            if (!craftingTable) return false;

            // Move to crafting table
            const moveResult = await smartPathfinderGoto(
                bot,
                new GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3),
                { timeoutMs: 15000 }
            );
            if (!moveResult.success) return false;

            const recipe = bot.recipesFor(chestId, null, 1, craftingTable)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1, craftingTable);
            await sleep(100);

            bb.log?.debug('Crafted storage chest');
            return true;
        } catch (error) {
            bb.log?.warn({ err: error }, 'Failed to craft chest');
            return false;
        }
    }

    private findChestPlacement(bot: Bot, villageCenter: Vec3): Vec3 | null {
        // Search positions near village center
        // Prefer corners (less likely to block walking paths)
        const placements = [
            villageCenter.offset(3, 0, 3),
            villageCenter.offset(-3, 0, 3),
            villageCenter.offset(3, 0, -3),
            villageCenter.offset(-3, 0, -3),
            villageCenter.offset(4, 0, 0),
            villageCenter.offset(-4, 0, 0),
            villageCenter.offset(0, 0, 4),
            villageCenter.offset(0, 0, -4),
            villageCenter.offset(2, 0, 2),
            villageCenter.offset(-2, 0, 2),
            villageCenter.offset(2, 0, -2),
            villageCenter.offset(-2, 0, -2),
        ];

        for (const pos of placements) {
            if (this.isValidChestPlacement(bot, pos)) {
                return pos;
            }
        }

        return null;
    }

    private isValidChestPlacement(bot: Bot, pos: Vec3): boolean {
        const groundBlock = bot.blockAt(pos.offset(0, -1, 0));
        const targetBlock = bot.blockAt(pos);
        const aboveTarget = bot.blockAt(pos.offset(0, 1, 0));

        // Must have valid surface below
        if (!groundBlock || !VALID_SURFACE_BLOCKS.includes(groundBlock.name)) {
            return false;
        }

        // Must have air at target and above
        if (!targetBlock || targetBlock.name !== 'air') return false;
        if (!aboveTarget || aboveTarget.name !== 'air') return false;

        // Check for open space (at least 2 sides open for access)
        const cardinalOffsets = [
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1),
        ];

        let openSides = 0;
        for (const offset of cardinalOffsets) {
            const checkPos = pos.plus(offset);
            const blockAtFeet = bot.blockAt(checkPos);
            if (blockAtFeet?.name === 'air') {
                openSides++;
            }
        }

        return openSides >= 2;
    }

    private async placeChest(bot: Bot, bb: LumberjackBlackboard, pos: Vec3): Promise<boolean> {
        try {
            const chestItem = bot.inventory.items().find(i => i.name === 'chest');
            if (!chestItem) return false;

            // Move to placement location
            const moveResult = await smartPathfinderGoto(
                bot,
                new GoalNear(pos.x, pos.y, pos.z, 3),
                { timeoutMs: 15000 }
            );
            if (!moveResult.success) return false;

            // Place the chest
            const groundBlock = bot.blockAt(pos.offset(0, -1, 0));
            if (!groundBlock) return false;

            await bot.equip(chestItem, 'hand');
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
            await sleep(200);

            // Verify placement
            const placedBlock = bot.blockAt(pos);
            return placedBlock?.name === 'chest';
        } catch (error) {
            bb.log?.warn({ err: error }, 'Failed to place chest');
            return false;
        }
    }
}
