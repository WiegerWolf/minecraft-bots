import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { FarmingBlackboard } from '../Blackboard';
import type { BehaviorNode, BehaviorStatus } from './types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear, GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// ITEM MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export class PickupItems implements BehaviorNode {
    name = 'PickupItems';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.nearbyDrops.length === 0) return 'failure';
        if (bb.inventoryFull) return 'failure';

        const drop = bb.nearbyDrops[0];
        if (!drop) return 'failure';

        console.log(`[BT] Picking up item at ${drop.position.floored()}`);
        bb.lastAction = 'pickup';

        try {
            await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            await sleep(300);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}

export class DepositItems implements BehaviorNode {
    name = 'DepositItems';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.inventoryFull && bb.produceCount < 32) return 'failure';
        if (bb.nearbyChests.length === 0) return 'failure';

        const chest = bb.nearbyChests[0];
        if (!chest) return 'failure';

        console.log(`[BT] Depositing items at ${chest.position}`);
        bb.lastAction = 'deposit';

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(chest.position, bot.world));
            const container = await bot.openContainer(chest);

            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'poisonous_potato'];
            for (const item of bot.inventory.items()) {
                if (crops.includes(item.name)) {
                    await container.deposit(item.type, null, item.count);
                }
            }

            container.close();
            return 'success';
        } catch {
            return 'failure';
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// FARMING ACTIONS
// ═══════════════════════════════════════════════════════════════

export class HarvestCrops implements BehaviorNode {
    name = 'HarvestCrops';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canHarvest) return 'failure';

        const crop = bb.nearbyMatureCrops[0];
        if (!crop) return 'failure';

        console.log(`[BT] Harvesting ${crop.name} at ${crop.position}`);
        bb.lastAction = 'harvest';

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(crop.position, bot.world));
            await bot.dig(crop);
            await sleep(200);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}

/**
 * Get crop types adjacent to a farmland block (for crop rotation)
 */
function getAdjacentCropTypes(bot: Bot, farmlandPos: Vec3): Set<string> {
    const cropTypes = new Set<string>();
    const offsets = [
        new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];
    for (const offset of offsets) {
        const block = bot.blockAt(farmlandPos.offset(offset.x, 1, offset.z));
        if (block) {
            if (block.name === 'wheat') cropTypes.add('wheat_seeds');
            if (block.name === 'carrots') cropTypes.add('carrot');
            if (block.name === 'potatoes') cropTypes.add('potato');
            if (block.name === 'beetroots') cropTypes.add('beetroot_seeds');
        }
    }
    return cropTypes;
}

export class PlantSeeds implements BehaviorNode {
    name = 'PlantSeeds';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canPlant) return 'failure';

        const farmland = bb.nearbyFarmland[0];
        if (!farmland) return 'failure';

        // Use crop rotation: prefer seeds different from adjacent crops
        const adjacentCrops = getAdjacentCropTypes(bot, farmland.position);
        const seedTypes = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'];
        const inventory = bot.inventory.items();

        let seedItem = null;
        // First: try seed NOT matching adjacent crops
        for (const seedType of seedTypes) {
            if (!adjacentCrops.has(seedType)) {
                seedItem = inventory.find(i => i.name === seedType);
                if (seedItem) break;
            }
        }
        // Fallback: any available seed
        if (!seedItem) {
            seedItem = inventory.find(i =>
                i.name.includes('seeds') || ['carrot', 'potato'].includes(i.name)
            );
        }
        if (!seedItem) return 'failure';

        console.log(`[BT] Planting ${seedItem.name} at ${farmland.position}`);
        bb.lastAction = 'plant';

        try {
            await bot.pathfinder.goto(new GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 2));
            bot.pathfinder.stop();

            await bot.equip(seedItem, 'hand');
            await bot.lookAt(farmland.position.offset(0.5, 1, 0.5), true);
            await bot.placeBlock(farmland, new Vec3(0, 1, 0));
            await sleep(150);
            return 'success';
        } catch (err) {
            console.log(`[BT] Planting failed: ${err}`);
            return 'failure';
        }
    }
}

export class TillGround implements BehaviorNode {
    name = 'TillGround';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canTill) return 'failure';
        if (!bb.farmCenter) return 'failure';

        // Find tillable block near water
        let target: { position: Vec3 } | null = null;

        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                const pos = bb.farmCenter.offset(x, 0, z);
                const block = bot.blockAt(pos);
                if (block && ['grass_block', 'dirt'].includes(block.name)) {
                    const above = bot.blockAt(pos.offset(0, 1, 0));
                    if (above && above.name === 'air') {
                        target = { position: pos };
                        break;
                    }
                }
            }
            if (target) break;
        }

        if (!target) return 'failure';

        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return 'failure';

        console.log(`[BT] Tilling ground at ${target.position}`);
        bb.lastAction = 'till';

        try {
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
            bot.pathfinder.stop();

            await bot.equip(hoe, 'hand');
            const block = bot.blockAt(target.position);
            if (block) {
                await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
                await bot.activateBlock(block);
                await sleep(200);
            }
            return 'success';
        } catch {
            return 'failure';
        }
    }
}

export class GatherSeeds implements BehaviorNode {
    name = 'GatherSeeds';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.needsSeeds) return 'failure';
        if (bb.nearbyGrass.length === 0) return 'failure';

        const grass = bb.nearbyGrass[0];
        if (!grass) return 'failure';

        console.log(`[BT] Breaking grass for seeds at ${grass.position}`);
        bb.lastAction = 'gather_seeds';

        try {
            await bot.pathfinder.goto(new GoalNear(grass.position.x, grass.position.y, grass.position.z, 2));
            await bot.dig(grass);
            await sleep(300);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// TOOL CRAFTING
// ═══════════════════════════════════════════════════════════════

/**
 * Find or place a crafting table and return it
 */
async function ensureCraftingTable(bot: Bot): Promise<Block | null> {
    // First, check if we have a crafting table in inventory
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
                // Move to it
                await bot.pathfinder.goto(new GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2));
                return tableBlock;
            }
        }
    }

    // If we have a crafting table item, place it
    if (craftingTableItem) {
        // Find a suitable spot to place it (solid block with air above)
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

            // Find or place crafting table
            const craftingTable = await ensureCraftingTable(bot);
            if (!craftingTable) {
                console.log(`[BT] No crafting table available`);
                return 'failure';
            }

            const hoeItem = bot.registry.itemsByName['wooden_hoe'];
            if (!hoeItem) return 'failure';

            // Get recipe with crafting table
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

export class GatherWood implements BehaviorNode {
    name = 'GatherWood';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.hasHoe) return 'failure';
        if (bb.plankCount >= 4) return 'failure'; // Enough for crafting table + hoe materials
        if (bb.logCount > 0) return 'failure'; // Have logs, go craft

        const logNames = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
        const logs = bot.findBlocks({
            matching: b => logNames.includes(b.name),
            maxDistance: 32,
            count: 1
        });

        if (logs.length === 0) return 'failure';

        const logPos = logs[0];
        if (!logPos) return 'failure';

        const logBlock = bot.blockAt(logPos);
        if (!logBlock) return 'failure';

        // Don't try to reach logs high up
        if (logBlock.position.y > bot.entity.position.y + 3) {
            return 'failure';
        }

        console.log(`[BT] Gathering wood at ${logBlock.position}`);
        bb.lastAction = 'gather_wood';

        try {
            await bot.pathfinder.goto(new GoalNear(logBlock.position.x, logBlock.position.y, logBlock.position.z, 2));
            await bot.dig(logBlock);
            await sleep(200);
            return 'success';
        } catch {
            return 'failure';
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// EXPLORATION
// ═══════════════════════════════════════════════════════════════

export class Explore implements BehaviorNode {
    name = 'Explore';
    private lastExploreTime = 0;

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Don't explore too frequently
        if (Date.now() - this.lastExploreTime < 5000) {
            return 'failure';
        }

        bb.consecutiveIdleTicks++;

        if (bb.consecutiveIdleTicks < 3) {
            return 'failure'; // Give other tasks a chance first
        }

        console.log(`[BT] Exploring for resources...`);
        bb.lastAction = 'explore';
        this.lastExploreTime = Date.now();

        // Pick a random direction
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 20;
        const target = bot.entity.position.offset(
            Math.cos(angle) * distance,
            0,
            Math.sin(angle) * distance
        );

        try {
            await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 3));
            bb.consecutiveIdleTicks = 0;
            return 'success';
        } catch {
            return 'failure';
        }
    }
}
