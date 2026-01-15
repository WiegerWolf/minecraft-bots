// ./src/roles/farming/BehaviorTree.ts
import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from './Blackboard';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear, GoalLookAtBlock } = goals;

export type BehaviorStatus = 'success' | 'failure' | 'running';

export interface BehaviorNode {
    name: string;
    tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus>;
}

// ═══════════════════════════════════════════════════════════════
// COMPOSITE NODES
// ═══════════════════════════════════════════════════════════════

export class Selector implements BehaviorNode {
    name: string;
    constructor(name: string, private children: BehaviorNode[]) {
        this.name = name;
    }
    
    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        for (const child of this.children) {
            const status = await child.tick(bot, bb);
            if (status !== 'failure') {
                return status;
            }
        }
        return 'failure';
    }
}

export class Sequence implements BehaviorNode {
    name: string;
    constructor(name: string, private children: BehaviorNode[]) {
        this.name = name;
    }
    
    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        for (const child of this.children) {
            const status = await child.tick(bot, bb);
            if (status !== 'success') {
                return status;
            }
        }
        return 'success';
    }
}

// ═══════════════════════════════════════════════════════════════
// CONDITION NODES (instant checks)
// ═══════════════════════════════════════════════════════════════

export class Condition implements BehaviorNode {
    constructor(
        public name: string,
        private check: (bb: FarmingBlackboard) => boolean
    ) {}
    
    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        return this.check(bb) ? 'success' : 'failure';
    }
}

// ═══════════════════════════════════════════════════════════════
// ACTION NODES
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

export class PlantSeeds implements BehaviorNode {
    name = 'PlantSeeds';
    
    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canPlant) return 'failure';
        
        const farmland = bb.nearbyFarmland[0];
        if (!farmland) return 'failure';
        
        const seedItem = bot.inventory.items().find(i => 
            i.name.includes('seeds') || ['carrot', 'potato'].includes(i.name)
        );
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

export class CraftHoe implements BehaviorNode {
    name = 'CraftHoe';
    
    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.hasHoe) return 'failure';
        
        // Try to craft with available resources
        if (bb.plankCount >= 2 && bb.stickCount >= 2) {
            console.log(`[BT] Crafting wooden hoe...`);
            bb.lastAction = 'craft_hoe';
            
            const hoeItem = bot.registry.itemsByName['wooden_hoe'];
            if (!hoeItem) return 'failure';
            
            const recipes = bot.recipesFor(hoeItem.id, null, 1, null);
            if (recipes.length === 0) return 'failure';
            
            try {
                const recipe = recipes[0];
                if (recipe) {
                    await bot.craft(recipe, 1);
                    return 'success';
                }
            } catch {
                return 'failure';
            }
        }
        
        // Need sticks?
        if (bb.plankCount >= 2 && bb.stickCount < 2) {
            console.log(`[BT] Crafting sticks...`);
            const stickItem = bot.registry.itemsByName['stick'];
            if (stickItem) {
                const recipes = bot.recipesFor(stickItem.id, null, 1, null);
                const recipe = recipes[0];
                if (recipe) {
                    try {
                        await bot.craft(recipe, 1);
                        return 'running'; // Continue crafting sequence
                    } catch {}
                }
            }
        }
        
        // Need planks from logs?
        if (bb.logCount > 0) {
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
                        } catch {}
                    }
                }
            }
        }
        
        return 'failure';
    }
}

export class GatherWood implements BehaviorNode {
    name = 'GatherWood';
    
    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (bb.hasHoe) return 'failure';
        if (bb.plankCount >= 4) return 'failure'; // Enough for hoe
        if (bb.logCount > 0) return 'failure'; // Have logs, go craft
        
        const logNames = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// BUILD THE TREE
// ═══════════════════════════════════════════════════════════════

export function createFarmingBehaviorTree(): BehaviorNode {
    return new Selector('Root', [
        // Priority 1: Pick up nearby items (always do this first)
        new PickupItems(),
        
        // Priority 2: Deposit if inventory full
        new DepositItems(),
        
        // Priority 3: Get tools if needed
        new Sequence('GetTools', [
            new Condition('NeedsHoe', bb => !bb.hasHoe),
            new Selector('ObtainHoe', [
                new CraftHoe(),
                new GatherWood(),
            ])
        ]),
        
        // Priority 4: Main farming loop
        new Selector('FarmingWork', [
            new HarvestCrops(),
            new PlantSeeds(),
            new TillGround(),
        ]),
        
        // Priority 5: Get seeds if needed
        new Sequence('GetSeeds', [
            new Condition('NeedsSeeds', bb => bb.needsSeeds),
            new GatherSeeds(),
        ]),
        
        // Priority 6: Explore as last resort
        new Explore(),
    ]);
}