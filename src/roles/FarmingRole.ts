import type { Bot } from 'mineflayer';
import type { Role } from './Role';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CraftingMixin } from './mixins/CraftingMixin';
import { KnowledgeMixin } from './mixins/KnowledgeMixin';
const minecraftData = require('minecraft-data');
let mcData: any = null;

const { GoalNear } = goals;

export class FarmingRole extends CraftingMixin(KnowledgeMixin(class { })) implements Role {
    name = 'farming';
    private active = false;
    private targetBlock: any = null;
    private state: 'IDLE' | 'FINDING' | 'MOVING' | 'ACTING' | 'COLLECTING' | 'CRAFTING' = 'IDLE';
    private lastActionTime = 0;
    private lastLogTime = 0;
    private lastPlanTime = 0;
    private isUpdating = false;
    
    private failedBlocks: Map<string, number> = new Map(); // position string -> timestamp (Hard failures: pathing, broken)
    private containerCooldowns: Map<string, number> = new Map(); // position string -> timestamp (Soft failures: empty chest)
    
    private readonly RETRY_COOLDOWN = 5 * 60 * 1000; // 5 minutes for hard failures
    private readonly CONTAINER_COOLDOWN = 30 * 1000; // 30 seconds for re-checking chests

    // Fix 1: Movement timeout tracking
    private movementStartTime: number = 0;
    private readonly MOVEMENT_TIMEOUT = 30000; // 30 seconds
    private collectionStartTime: number = 0;
    private readonly COLLECTION_TIMEOUT = 10000; // 10 seconds
    private readonly ACTION_REACH = 3.5; // Distance to act on blocks without moving closer
    private readonly MAX_FARMLAND_PER_WATER = 81; // 9x9 area
    
    // Deposit settings
    private readonly MAX_SEEDS_TO_KEEP = 64; // Keep 1 stack of seeds

    // Bot reference for event handlers
    private bot: Bot | null = null;

    // Bound event handlers for proper cleanup
    private boundOnGoalReached: (() => void) | null = null;
    private boundOnPathUpdate: ((result: any) => void) | null = null;

    protected override log(message: string, ...args: any[]) {
        console.log(`[Farming] ${message}`, ...args);
    }

    start(bot: Bot) {
        this.active = true;
        this.state = 'FINDING';
        this.bot = bot;
        if (!mcData) mcData = minecraftData(bot.version);

        // Fix 2: Set up pathfinder event handlers
        this.boundOnGoalReached = this.onGoalReached.bind(this);
        this.boundOnPathUpdate = this.onPathUpdate.bind(this);
        bot.on('goal_reached', this.boundOnGoalReached);
        bot.on('path_update', this.boundOnPathUpdate);

        bot.chat('🌾 Starting farming...');
        this.log('Started farming role.');

        // 3. Initialize Farm Center from existing environment
        const existingFarm = bot.findBlock({
            matching: (b) => b.name === 'farmland',
            maxDistance: 32
        });
        if (existingFarm) {
            this.rememberPOI('farm_center', existingFarm.position);
            this.log(`Detected existing farm at ${existingFarm.position}. Set as farm center.`);
        }
    }

    stop(bot: Bot) {
        this.active = false;
        this.state = 'IDLE';
        this.targetBlock = null;
        this.failedBlocks.clear();
        this.containerCooldowns.clear();

        // Fix 2: Clean up pathfinder event handlers
        if (this.boundOnGoalReached) {
            bot.removeListener('goal_reached', this.boundOnGoalReached);
        }
        if (this.boundOnPathUpdate) {
            bot.removeListener('path_update', this.boundOnPathUpdate);
        }
        this.bot = null;

        bot.pathfinder.setGoal(null);
        bot.chat('🛑 Stopped farming.');
        this.log('Stopped farming role.');
    }

    // Fix 2: Handle pathfinder goal_reached event
    private onGoalReached() {
        if (!this.active) return;

        if (this.state === 'MOVING') {
            this.log('Goal reached via event. Switching to ACTING.');
            this.state = 'ACTING';
        } else if (this.state === 'COLLECTING') {
            // Item collected, look for more or go back to finding
            this.log('Reached item position.');
        }
    }

    // Fix 2: Handle pathfinder path_update event (detects unreachable goals)
    private onPathUpdate(result: any) {
        if (!this.active || this.state !== 'MOVING') return;

        // result.status can be 'noPath', 'timeout', 'success', etc.
        if (result.status === 'noPath' || result.status === 'timeout') {
            this.log(`Pathfinding failed: ${result.status}. Marking block as failed.`);
            if (this.targetBlock) {
                this.failedBlocks.set(this.targetBlock.position.toString(), Date.now());
            }
            this.targetBlock = null;
            this.intention = 'NONE';
            this.state = 'FINDING';
        }
    }

    private intention: 'NONE' | 'HARVEST' | 'PLANT' | 'TILL' | 'MAKE_WATER' | 'GATHER_WOOD' | 'GATHER_SEEDS' | 'CHECK_STORAGE' | 'RETURN_TO_FARM' | 'DEPOSIT_ITEMS' | 'PLACE_CHEST' = 'NONE';
    // lastRequestTime is inherited from CraftingMixin

    async update(bot: Bot) {
        if (!this.active || !bot.entity || this.isUpdating) return;
        this.isUpdating = true;
        try {
            switch (this.state) {
                case 'FINDING':
                    await this.findTask(bot);
                    break;
                case 'IDLE':
                    // Just wait
                    break;
                case 'MOVING':
                    // Fix 1: Check for movement timeout
                    if (Date.now() - this.movementStartTime > this.MOVEMENT_TIMEOUT) {
                        this.log('Movement timeout! Marking block as failed and returning to FINDING.');
                        if (this.targetBlock) {
                            this.failedBlocks.set(this.targetBlock.position.toString(), Date.now());
                        }
                        this.targetBlock = null;
                        this.intention = 'NONE';
                        bot.pathfinder.setGoal(null);
                        this.state = 'FINDING';
                        break;
                    }

                    // Original distance check (kept as backup for goal_reached event)
                    if (this.targetBlock && bot.entity?.position && bot.entity.position.distanceTo(this.targetBlock.position) < this.ACTION_REACH) {
                        this.log('Reached target reach. Switching to ACTING.');
                        bot.pathfinder.setGoal(null); // Stop moving
                        this.state = 'ACTING';
                    }
                    break;
                case 'ACTING':
                    await this.performAction(bot);
                    break;
                case 'COLLECTING':
                    await this.collectItems(bot);
                    break;
                case 'CRAFTING':
                    break;
            }
        } finally {
            this.isUpdating = false;
        }
    }

    // Helper to set movement target or act immediately if within reach
    private setMovementTarget(bot: Bot, block: any, intention: typeof this.intention, goalRange: number = 1) {
        this.targetBlock = block;
        this.intention = intention;

        // Check if we are already within reach to skip moving
        const botPos = bot.entity?.position;
        if (botPos && botPos.distanceTo(block.position) < this.ACTION_REACH) {
            this.log(`Target ${intention} at ${block.position} is already within reach (${botPos.distanceTo(block.position).toFixed(1)}m). Switching to ACTING.`);
            this.state = 'ACTING';
            bot.pathfinder.setGoal(null);
            return;
        }

        const distStr = botPos ? `${botPos.distanceTo(block.position).toFixed(1)}m` : 'unknown distance';
        this.log(`Target ${intention} at ${block.position} is too far (${distStr}). Moving...`);
        this.state = 'MOVING';
        this.movementStartTime = Date.now();
        bot.pathfinder.setGoal(new GoalNear(block.position.x, block.position.y, block.position.z, goalRange));
    }

    // Fix 4: Validate that the block matches what we expect for our intention
    private validateBlockForIntention(block: any): boolean {
        // Special case for returning to farm anchor, no specific block needed
        if (this.intention === 'RETURN_TO_FARM') return true;
        
        if (!block) return false;

        switch (this.intention) {
            case 'HARVEST':
                // Must be a mature crop
                return this.isMature(block);

            case 'PLANT':
                // Must be farmland with air above
                return block.name === 'farmland';

            case 'TILL':
                // Must be dirt or grass
                return block.name === 'grass_block' || block.name === 'dirt';

            case 'MAKE_WATER':
                // Must be diggable (dirt/grass)
                return block.name === 'grass_block' || block.name === 'dirt';

            case 'GATHER_WOOD':
                // Must be a log or stem
                return block.name.includes('_log') || block.name.includes('_stem');

            case 'GATHER_SEEDS':
                // Must be grass or tall grass or fern (check multiple names)
                const validNames = ['grass', 'tall_grass', 'short_grass', 'fern', 'large_fern'];
                return validNames.includes(block.name);

            case 'CHECK_STORAGE':
            case 'DEPOSIT_ITEMS':
                // Must be a container
                return ['chest', 'barrel', 'trapped_chest'].includes(block.name);

            case 'PLACE_CHEST':
                // Validating the "ground" block we want to place on
                // It must be solid.
                return block.boundingBox === 'block';

            case 'NONE':
                // If crafting, allow crafting table
                if (this.craftingItem) {
                    return block.name === 'crafting_table';
                }
                return false;
            default:
                return false;
        }
    }

    private isMature(block: any): boolean {
        if (!block) return false;
        const cropNames = ['wheat', 'carrots', 'potatoes', 'beetroots', 'crops'];
        if (!cropNames.includes(block.name)) return false;

        // Try getting age from properties (modern versions)
        const props = block.getProperties();
        let age = -1;
        let maxAge = block.name === 'beetroots' ? 3 : 7;

        if (props && props.age !== undefined) {
            age = parseInt(props.age);
        } else {
            // Fallback to metadata
            age = block.metadata as any;
        }

        const mature = age >= maxAge;
        if (mature) {
            this.log(`Detected mature ${block.name} at ${block.position} (age/meta: ${age}/${maxAge})`);
        }
        return mature;
    }

    private async findTask(bot: Bot) {
        // 1. Find mature crops to harvest
        const now = Date.now();
        const shouldLog = now - this.lastLogTime > 10000; // Log status every 10s if idle

        if (shouldLog) {
            this.log('Checking for tasks...');
            const inventory = bot.inventory.items();
            if (now - this.lastActionTime > 30000) {
                this.log(`Inventory: ${inventory.length > 0 ? inventory.map(i => `${i.name}x${i.count}`).join(', ') : 'empty'}`);
            }
            this.lastLogTime = now;
        }
        
        // 1.0 Get Farm Anchor (POI)
        const farmAnchor = this.getNearestPOI(bot, 'farm_center');
        
        // 1.1 DEPOSIT CHECK (High Priority)
        // If inventory is full or we have too many produce items, go deposit.
        if (this.shouldDeposit(bot)) {
            // Find deposit chest
            if (await this.findDepositTarget(bot, farmAnchor)) {
                return;
            } else if (shouldLog) {
                this.log("Inventory full/high but no chest found to deposit!");
            }
        }
        
        const harvestable = bot.findBlock({
            matching: (block) => {
                if (!block || !block.position) return false;
                const posStr = block.position.toString();
                const failedAt = this.failedBlocks.get(posStr);
                if (failedAt && Date.now() - failedAt < this.RETRY_COOLDOWN) return false;

                return this.isMature(block);
            },
            maxDistance: 32,
            useExtraInfo: true,
            point: farmAnchor ? farmAnchor.position : bot.entity.position // Search near farm if we have one
        });

        if (harvestable) {
            this.log(`Found harvestable ${harvestable.name} at ${harvestable.position}.`);
            this.setMovementTarget(bot, harvestable, 'HARVEST');
            return;
        }

        // 1.5 PRIORITY: Check if we have any seeds. If not, we must gather them before doing anything else.
        const inventory = bot.inventory.items();
        const hasSeeds = inventory.some(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
        );

        if (!hasSeeds) {
            if (shouldLog) this.log('No seeds in inventory. Prioritizing seed gathering...');
            // Try to find seeds nearby (breaking grass or checking chests)
            const foundSeedsTarget = await this.findSeedsNearby(bot);
            
            if (foundSeedsTarget) {
                return; // We have a target, exit findTask
            } else {
                // IMPORTANT: If we have no seeds and cannot find any way to get them,
                // we should NOT proceed to Tilling or Planting, as that will just loop forever.
                if (shouldLog) this.log('No seeds and no grass/storage nearby (checked recently). Cannot farm. Waiting...');
                return; 
            }
        }

        // 1.6 PRIORITY: Return to farm anchor if we drifted away
        if (farmAnchor) {
            const dist = bot.entity.position.distanceTo(farmAnchor.position);
            // If we are far away (> 32 blocks) and not currently busy with a specific task
            if (dist > 32) {
                this.log(`Drifted too far from farm anchor (${dist.toFixed(1)}m). Returning to ${farmAnchor.position}...`);
                // Create a dummy target block just for the position
                this.setMovementTarget(bot, { position: farmAnchor.position } as any, 'RETURN_TO_FARM', 2);
                return;
            }
        }

        // 2. Find empty farmland to plant
        if (shouldLog && bot.entity?.position) {
            this.log(`Bot position: ${bot.entity.position.floored()}. Searching for farmland (maxDist: 32)...`);
        }

        const farmlandId = mcData?.blocksByName?.farmland?.id;
        const allFarmlands = bot.findBlocks({
            matching: (block) => farmlandId ? block.type === farmlandId : block.name === 'farmland',
            maxDistance: 32,
            count: 256,
            point: farmAnchor ? farmAnchor.position : bot.entity.position // Prioritize existing farm area
        });

        if (shouldLog) {
            this.log(`Found ${allFarmlands.length} farmland blocks total in range.`);
        }

        const emptyFarmlands = allFarmlands.filter(pos => {
            const block = bot.blockAt(pos);
            if (!block) return false;

            const posStr = block.position.toString();
            const failedAt = this.failedBlocks.get(posStr);
            if (failedAt && Date.now() - failedAt < this.RETRY_COOLDOWN) {
                return false;
            }

            const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
            const isAir = blockAbove && (
                blockAbove.name === 'air' ||
                blockAbove.name === 'cave_air' ||
                blockAbove.name === 'void_air' ||
                blockAbove.name === 'grass' ||
                blockAbove.name === 'tall_grass' ||
                blockAbove.name === 'short_grass' || // Support modern names
                blockAbove.name === 'fern'
            );

            return isAir;
        });

        if (emptyFarmlands.length > 0) {
            if (shouldLog) {
                this.log(`Found ${emptyFarmlands.length} empty and suitable farmlands.`);
            }
            const bestFarmland = emptyFarmlands
                .map(pos => bot.blockAt(pos)!)
                .sort((a, b) => {
                    const aHydrated = this.isHydrated(bot, a.position) ? 1 : 0;
                    const bHydrated = this.isHydrated(bot, b.position) ? 1 : 0;
                    if (aHydrated !== bHydrated) return bHydrated - aHydrated;
                    
                    // Sort by distance to Farm Anchor if it exists, otherwise bot
                    const targetPos = farmAnchor ? farmAnchor.position : bot.entity?.position;
                    if (!targetPos) return 0;
                    return targetPos.distanceTo(a.position) - targetPos.distanceTo(b.position);
                })[0];

            if (bestFarmland) {
                const cropToPlant = this.getOptimalCrop(bot, bestFarmland.position);
                if (cropToPlant) {
                    this.log(`Found farmland at ${bestFarmland.position}. Plan to plant ${cropToPlant}.`);
                    this.setMovementTarget(bot, bestFarmland, 'PLANT');
                    return;
                } else if (shouldLog) {
                    const seeds = bot.inventory.items().filter(item =>
                        item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
                    );
                    this.log(`Found farmland but getOptimalCrop returned null. Seeds in inventory: ${seeds.length > 0 ? seeds.map(s => s.name).join(', ') : 'none'}`);
                }
            }
        }

        // 3. Find dirt/grass to till (if we have a hoe)
        const hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        if (hoe) {
            if (shouldLog) {
                this.log(`Hoe found: ${hoe.name}. Looking for tillable blocks near water...`);
            }

            const waterIds = ['water', 'flowing_water'].map(name => mcData?.blocksByName?.[name]?.id).filter(id => id !== undefined);
            
            // Search for water around the farm anchor if it exists
            const searchPoint = farmAnchor ? farmAnchor.position : bot.entity.position;
            
            const waterBlocks = bot.findBlocks({
                matching: (block) => waterIds.length > 0 ? waterIds.includes(block.type) : (block.name === 'water' || block.name === 'flowing_water'),
                maxDistance: 32,
                point: searchPoint,
                count: 20
            });

            if (shouldLog && waterBlocks.length === 0) {
                this.log('No water sources found nearby for tilling.');
            }

            const candidates: { pos: Vec3, block: any, score: number }[] = [];
            const checkedPos = new Set<string>();

            for (const waterPos of waterBlocks) {
                // Check ±4 blocks horizontally, and water can be at Y or Y+1 relative to farmland
                // So farmland can be at waterPos.Y or waterPos.Y-1
                for (let dy = -1; dy <= 0; dy++) {
                    for (let dx = -4; dx <= 4; dx++) {
                        for (let dz = -4; dz <= 4; dz++) {
                            const pos = waterPos.offset(dx, dy, dz);
                            const posStr = pos.toString();
                            if (checkedPos.has(posStr)) continue;
                            checkedPos.add(posStr);

                            const failedAt = this.failedBlocks.get(posStr);
                            if (failedAt && Date.now() - failedAt < this.RETRY_COOLDOWN) continue;

                            const block = bot.blockAt(pos);
                            if (block && (block.name === 'grass_block' || block.name === 'dirt')) {
                                const above = bot.blockAt(pos.offset(0, 1, 0));
                                if (above && (above.name === 'air' || above.name === 'cave_air' || above.name === 'void_air')) {
                                    // Scoring system
                                    let score = 0;

                                    // Prefer blocks adjacent to existing farmland (contiguous growth)
                                    const neighbors = [
                                        pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
                                        pos.offset(0, 0, 1), pos.offset(0, 0, -1)
                                    ];
                                    for (const nPos of neighbors) {
                                        const nBlock = bot.blockAt(nPos);
                                        if (nBlock && nBlock.name === 'farmland') score += 10;
                                    }

                                    // Prefer same level as water
                                    if (dy === 0) score += 5;

                                    // Penalty for distance to FARM ANCHOR if exists, otherwise bot
                                    const distRef = farmAnchor ? farmAnchor.position : bot.entity.position;
                                    const dist = distRef.distanceTo(pos);
                                    score -= dist * 0.5;

                                    candidates.push({ pos, block, score });
                                }
                            }
                        }
                    }
                }
            }

            if (candidates.length > 0) {
                // Filter candidates by water source limit
                const validCandidates = candidates.filter(c => {
                    const nearestWater = bot.findBlock({
                        matching: (block) => waterIds.length > 0 ? waterIds.includes(block.type) : (block.name === 'water' || block.name === 'flowing_water'),
                        point: c.pos,
                        maxDistance: 5
                    });
                    if (!nearestWater) return true;

                    // Count farmland within 4 blocks of this water
                    const existingFarmland = bot.findBlocks({
                        matching: (block: any) => block.name === 'farmland',
                        point: nearestWater.position,
                        maxDistance: 4,
                        count: 200
                    });

                    return existingFarmland.length < this.MAX_FARMLAND_PER_WATER;
                });

                if (validCandidates.length > 0) {
                    validCandidates.sort((a, b) => b.score - a.score);
                    const best = validCandidates[0]!;
                    this.log(`Selected best tilling spot at ${best.pos} with score ${best.score.toFixed(1)} (Valid candidates: ${validCandidates.length}/${candidates.length})`);
                    this.setMovementTarget(bot, best.block, 'TILL');
                    return;
                } else {
                    this.log('Found tillable blocks, but water sources have reached their farmland limit.');
                }
            }
        }

        // 4. If no immediate tasks, try to plan a new field (find water or make it)
        await this.planField(bot);
        if (this.state !== 'FINDING' && this.state !== 'IDLE') return;

        // 5. Check needs (crafting etc)
        await this.checkNeeds(bot);

        if (this.state === 'FINDING') {
            const inventory = bot.inventory.items();
            const hasHoe = inventory.some(item => item.name.includes('hoe'));
            const logs = inventory.filter(i => i.name.includes('_log') || i.name.includes('_stem'));
            const planks = inventory.filter(i => i.name.endsWith('_planks'));
            const numSticks = inventory.filter(i => i.name === 'stick').reduce((acc, item) => acc + item.count, 0);

            if (!hasHoe && logs.length === 0 && (planks.length < 3 || numSticks < 2)) {
                const logBlock = bot.findBlock({
                    matching: block => block && (block.name.includes('_log') || block.name.includes('_stem')),
                    maxDistance: 32
                });
                if (logBlock && !this.failedBlocks.has(logBlock.position.toString())) {
                    this.log(`Found log at ${logBlock.position}. Targeting for wood because tools are low.`);
                    this.setMovementTarget(bot, logBlock, 'GATHER_WOOD');
                    return;
                }
            }
        }

        if (this.state === 'FINDING') {
            this.state = 'IDLE';
            setTimeout(() => {
                if (this.active) {
                    this.state = 'FINDING';
                }
            }, 2000);
        }
    }

    private async planField(bot: Bot) {
        const now = Date.now();
        if (now - this.lastPlanTime < 10000) return;
        this.lastPlanTime = now;

        if (this.state !== 'FINDING') return;

        const inventory = bot.inventory.items();
        const hoe = inventory.find(item => item.name.includes('hoe'));
        const seeds = inventory.filter(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
        );

        if (!hoe || seeds.length === 0) return;

        const waterBlock = bot.findBlock({
            matching: block => block && (block.name === 'water' || block.name === 'flowing_water'),
            maxDistance: 32
        });

        if (waterBlock) {
            const candidates: { pos: Vec3, block: any, score: number }[] = [];
            for (let dy = -1; dy <= 0; dy++) {
                for (let x = -4; x <= 4; x++) {
                    for (let z = -4; z <= 4; z++) {
                        const pos = waterBlock.position.offset(x, dy, z);
                        if (this.failedBlocks.has(pos.toString())) continue;
                        const block = bot.blockAt(pos);
                        const above = bot.blockAt(pos.offset(0, 1, 0));
                        if (block && (block.name === 'grass_block' || block.name === 'dirt') && above && above.name === 'air') {
                            let score = 0;
                            const neighbors = [
                                pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
                                pos.offset(0, 0, 1), pos.offset(0, 0, -1)
                            ];
                            for (const nPos of neighbors) {
                                const nBlock = bot.blockAt(nPos);
                                if (nBlock && nBlock.name === 'farmland') score += 10;
                            }
                            if (dy === 0) score += 5;
                            const dist = bot.entity.position.distanceTo(pos);
                            score -= dist * 0.5;
                            candidates.push({ pos, block, score });
                        }
                    }
                }
            }
            if (candidates.length > 0) {
                candidates.sort((a, b) => b.score - a.score);
                const best = candidates[0]!;
                this.log(`Found water at ${waterBlock.position}. Planning field starting at ${best.pos} (score ${best.score.toFixed(1)})`);
                this.setMovementTarget(bot, best.block, 'TILL');
                return;
            }
        }

        const waterBucket = bot.inventory.items().find(i => i.name === 'water_bucket');
        if (waterBucket) {
            const flatSpot = bot.findBlock({
                matching: block => {
                    if (!block || !(block.name === 'grass_block' || block.name === 'dirt')) return false;
                    const above = bot.blockAt(block.position.offset(0, 1, 0));
                    return !!(above && (above.name === 'air' || above.name === 'cave_air' || above.name === 'void_air'));
                },
                maxDistance: 16,
                useExtraInfo: true
            });

            if (flatSpot) {
                this.log(`Found spot for water source at ${flatSpot.position}. Targeting...`);
                this.setMovementTarget(bot, flatSpot, 'MAKE_WATER', 2);
                return;
            }
        } else if (Date.now() - this.lastRequestTime > 30000) {
            const crops = bot.findBlock({ matching: b => b && ['wheat', 'carrots', 'potatoes', 'beetroots'].includes(b.name), maxDistance: 32 });
            if (!crops && !waterBlock) {
                bot.chat("I can't find any water or farms! If you give me a water bucket, I can make a farm.");
                this.lastRequestTime = Date.now();
            }
        }
    }

    private async performAction(bot: Bot) {
        if (!this.targetBlock) {
            this.state = 'FINDING';
            return;
        }

        const block = bot.blockAt(this.targetBlock.position);
        
        // Handle special return to farm intention
        if (this.intention === 'RETURN_TO_FARM') {
            this.log('Returned to farm area.');
            this.state = 'FINDING';
            this.intention = 'NONE';
            return;
        }

        if (!block) {
            this.log('Target block no longer exists. Back to FINDING.');
            this.state = 'FINDING';
            return;
        }

        if (!this.validateBlockForIntention(block)) {
            this.log(`Block type mismatch: expected block for ${this.intention}, got ${block.name}. Back to FINDING.`);
            this.state = 'FINDING';
            this.intention = 'NONE';
            return;
        }

        this.log(`Performing action ${this.intention} on ${block.name} at ${block.position}...`);
        this.lastActionTime = Date.now();

        try {
            if (this.craftingItem) {
                await this.performCraftingAction(bot, block);
                this.state = 'FINDING';
                return;
            }

            if (this.intention === 'HARVEST') {
                try {
                    await bot.dig(block);
                    this.state = 'COLLECTING';
                    this.log('Dig success. Switching to COLLECTING.');
                } catch (err: any) {
                    if (err.message === 'Digging aborted') {
                        this.state = 'FINDING';
                        this.log('Digging aborted.');
                    } else { throw err; }
                }
            } else if (this.intention === 'PLANT') {
                const cropToPlant = this.getOptimalCrop(bot, block.position);
                if (cropToPlant) {
                    const seedItem = bot.inventory.items().find(item => item.name === cropToPlant);
                    if (seedItem) {
                        this.log(`Equipping ${seedItem.name} for planting...`);
                        await bot.equip(seedItem, 'hand');
                        this.log(`Attempting to plant ${cropToPlant} on ${block.name} at ${block.position}...`);
                        await bot.placeBlock(block, new Vec3(0, 1, 0));
                        this.log(`Successfully planted ${cropToPlant}.`);
                        
                        // Update Farm Anchor
                        this.rememberPOI('farm_center', block.position);
                    } else {
                        this.log(`Could not find seed item ${cropToPlant} in inventory!`);
                    }
                } else {
                    this.log('getOptimalCrop returned null in performAction.');
                }
                this.state = 'FINDING';
            } else if (this.intention === 'TILL') {
                const hoe = bot.inventory.items().find(item => item.name.includes('_hoe'));
                if (hoe) {
                    await bot.equip(hoe, 'hand');
                    await bot.activateBlock(block);
                    this.log(`Tilled ${block.name} at ${block.position}. Verifying...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const updatedBlock = bot.blockAt(block.position);
                    if (updatedBlock && updatedBlock.name === 'farmland') {
                        this.log('Verification success: Block is now farmland.');
                        this.failedBlocks.delete(block.position.toString());
                        
                        // Update Farm Anchor
                        this.rememberPOI('farm_center', block.position);
                    } else {
                        this.log(`Verification failed: Block is ${updatedBlock?.name}. Blacklisting ${block.position} for cooldown.`);
                        this.failedBlocks.set(block.position.toString(), Date.now());
                    }
                } else { this.log('No hoe found for tilling.'); }
                this.state = 'FINDING';
            } else if (this.intention === 'MAKE_WATER') {
                this.log('Digging hole for water...');
                const shovel = bot.inventory.items().find(i => i.name.includes('shovel'));
                if (shovel) await bot.equip(shovel, 'hand');
                await bot.dig(block);
                const blockBelow = bot.blockAt(block.position.offset(0, -1, 0));
                const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
                if (bucket && blockBelow) {
                    this.log('Placing water bucket...');
                    await bot.equip(bucket, 'hand');
                    await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
                    this.log('Water source created!');
                } else { this.log('Failed to place water.'); }
                this.state = 'FINDING';
            } else if (this.intention === 'GATHER_WOOD') {
                this.log('Gathering wood...');
                await bot.dig(block);
                this.log('Wood gathered.');
                this.state = 'COLLECTING';
            } else if (this.intention === 'GATHER_SEEDS') {
                this.log('Breaking grass for seeds...');
                await bot.dig(block);
                this.log('Grass broken.');
                this.state = 'COLLECTING';
            } else if (this.intention === 'CHECK_STORAGE') {
                this.log(`Opening ${block.name} at ${block.position} to check for seeds...`);
                const container = await bot.openContainer(block);
                const items = container.items();
                const seeds = items.filter(item =>
                    item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
                );

                if (seeds.length > 0) {
                    this.log(`Found ${seeds.length} seed stacks in storage. Withdrawing...`);
                    for (const seed of seeds) {
                        await container.withdraw(seed.type, null, seed.count);
                    }
                    this.log('Successfully withdrew seeds.');
                } else {
                    this.log('No seeds found in this storage.');
                    // USE CONTAINER COOLDOWN INSTEAD OF FAILED BLOCKS
                    this.containerCooldowns.set(block.position.toString(), Date.now());
                }
                container.close();
                this.state = 'FINDING';
            } else if (this.intention === 'DEPOSIT_ITEMS') {
                this.log(`Opening ${block.name} at ${block.position} to deposit produce...`);
                const container = await bot.openContainer(block);
                
                // Deposit Logic
                const items = bot.inventory.items();
                for (const item of items) {
                    // Check if it's a produce item or seed
                    const isProduce = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin', 'poisonous_potato'].includes(item.name);
                    const isSeed = item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato';
                    
                    if (isProduce || isSeed) {
                        let amountToDeposit = item.count;
                        
                        // If it's a seed (or seed-like crop), we need to reserve some
                        if (isSeed) {
                             // Check total amount of this specific seed we have
                             const totalCount = items.filter(i => i.name === item.name).reduce((sum, i) => sum + i.count, 0);
                             
                             // If this stack is part of the reserved amount
                             if (totalCount <= this.MAX_SEEDS_TO_KEEP) {
                                 continue; // Don't deposit any
                             }
                             
                             // Simple strategy: deposit everything then withdraw needed amount
                             await container.deposit(item.type, null, item.count);
                             continue;
                        }
                        
                        // If purely produce (wheat, melon, etc), deposit all
                        await container.deposit(item.type, null, item.count);
                    }
                }
                
                // Now ensure we have seeds back
                const seedNames = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
                for (const seedName of seedNames) {
                     const currentCount = bot.inventory.items().filter(i => i.name === seedName).reduce((sum, i) => sum + i.count, 0);
                     if (currentCount < this.MAX_SEEDS_TO_KEEP) {
                         // Withdraw difference
                         const needed = this.MAX_SEEDS_TO_KEEP - currentCount;
                         const itemInChest = container.items().find(i => i.name === seedName);
                         if (itemInChest) {
                             const withdrawAmt = Math.min(needed, itemInChest.count);
                             if (withdrawAmt > 0) {
                                 await container.withdraw(itemInChest.type, null, withdrawAmt);
                             }
                         }
                     }
                }
                
                this.log('Deposit complete.');
                container.close();
                
                // Remember this as farm chest
                this.rememberPOI('farm_chest', block.position);
                
                this.state = 'FINDING';
            } else if (this.intention === 'PLACE_CHEST') {
                this.log(`Placing farm chest on ${block.name} at ${block.position}...`);
                const chestItem = bot.inventory.items().find(i => i.name === 'chest');
                if (chestItem) {
                    await bot.equip(chestItem, 'hand');
                    await bot.placeBlock(block, new Vec3(0, 1, 0));
                    this.log('Chest placed.');
                    
                    // The new chest will be at block.position + y1
                    const chestPos = block.position.offset(0, 1, 0);
                    this.rememberPOI('farm_chest', chestPos);
                } else {
                    this.log('No chest item found to place!');
                }
                this.state = 'FINDING';
            } else {
                this.log(`Unknown intention ${this.intention}, resetting.`);
                this.state = 'FINDING';
            }
        } catch (err) {
            console.error('Error performing action:', err);
            this.log(`Error performing action: ${err}`);
            this.state = 'FINDING';
        } finally {
            this.intention = 'NONE';
        }
    }

    private async collectItems(bot: Bot) {
        if (!bot.entity) return;
        if (this.collectionStartTime === 0) this.collectionStartTime = Date.now();
        const botPos = bot.entity.position;
        const itemEntity = bot.nearestEntity(entity =>
            entity.name === 'item' && botPos.distanceTo(entity.position) < 6
        );
        if (itemEntity) {
            const currentGoal = bot.pathfinder.goal;
            if (!currentGoal) {
                bot.pathfinder.setGoal(new GoalNear(itemEntity.position.x, itemEntity.position.y, itemEntity.position.z, 0.5));
            }
        } else {
            this.log('No items to collect nearby. Back to FINDING.');
            this.collectionStartTime = 0;
            this.state = 'FINDING';
            return;
        }
        if (Date.now() - this.collectionStartTime > this.COLLECTION_TIMEOUT) {
            this.log('Collecting timed out. Back to FINDING.');
            this.collectionStartTime = 0;
            bot.pathfinder.setGoal(null);
            this.state = 'FINDING';
        }
    }

    private isHydrated(bot: Bot, position: Vec3): boolean {
        const block = bot.blockAt(position);
        if (block && block.name === 'farmland' && block.metadata > 0) return true;
        // Farmland is hydrated if water is within 4 blocks horizontally AND 
        // at the same Y level or 1 block above the farmland.
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                for (let y = 0; y <= 1; y++) {
                    const b = bot.blockAt(position.offset(x, y, z));
                    if (b && (b.name === 'water' || b.name === 'flowing_water')) return true;
                }
            }
        }
        return false;
    }

    private getOptimalCrop(bot: Bot, position: Vec3): string | null {
        const inventory = bot.inventory.items();
        const availableSeeds = inventory.filter(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot' ||
            item.name === 'wheat_seeds' || item.name === 'beetroot_seeds' || item.name === 'melon_seeds' || item.name === 'pumpkin_seeds'
        );
        if (availableSeeds.length === 0) {
            // Log items if we have none available but we were expected to plant
            // This is handled by the caller logging, but let's be extra sure
            return null;
        }

        const neighbors = [
            bot.blockAt(position.offset(1, 0, 0)),
            bot.blockAt(position.offset(-1, 0, 0)),
            bot.blockAt(position.offset(0, 0, 1)),
            bot.blockAt(position.offset(0, 0, -1))
        ];
        const neighborCrops = neighbors
            .filter(n => n && ['wheat', 'carrots', 'potatoes', 'beetroots'].includes(n.name))
            .map(n => n!.name);

        for (const seed of availableSeeds) {
            let cropName = seed.name.replace('_seeds', '');
            if (cropName === 'seeds') cropName = 'wheat';
            if (cropName === 'beetroot') cropName = 'beetroots';
            if (cropName === 'carrot') cropName = 'carrots';
            if (cropName === 'potato') cropName = 'potatoes';

            if (!neighborCrops.includes(cropName)) {
                return seed.name;
            }
        }

        // If all seeds are already neighbors, just pick the first one
        return availableSeeds[0]?.name ?? null;
    }

    private async checkNeeds(bot: Bot) {
        const inventory = bot.inventory.items();
        const count = (predicate: (item: any) => boolean) =>
                inventory.filter(predicate).reduce((acc, item) => acc + item.count, 0);

        // 1. Tool check (Hoe)
        const hasHoe = inventory.some(item => item.name.includes('hoe'));
        if (!hasHoe) {
            const numSticks = count(i => i.name === 'stick');
            const numPlanks = count(i => i.name.endsWith('_planks'));
            const numLogs = count(i => i.name.includes('_log') || i.name.includes('_stem'));
            const planksNeeded = 3 + (numSticks < 2 ? 2 : 0);
            
            if (numPlanks < planksNeeded && numLogs > 0) {
                const logItem = inventory.find(i => i.name.includes('_log') || i.name.includes('_stem'));
                if (logItem) {
                    const plankName = logItem.name.replace('_log', '_planks').replace('_stem', '_planks');
                    this.log(`Crafting planks from ${logItem.name} for hoe...`);
                    await this.tryCraft(bot, plankName, (target) => {
                        this.targetBlock = target;
                        this.state = 'MOVING';
                    });
                    return;
                }
            }
            if (numSticks < 2 && numPlanks >= 2) {
                this.log('Crafting sticks for hoe...');
                await this.tryCraft(bot, 'stick', (target) => {
                    this.targetBlock = target;
                    this.state = 'MOVING';
                });
                return;
            }
            const canCraftHoe = this.canCraft(bot, 'wooden_hoe');
            if (canCraftHoe) {
                this.log('Attempting to craft wooden_hoe...');
                const success = await this.tryCraft(bot, 'wooden_hoe', (target) => {
                    this.targetBlock = target;
                    this.state = 'MOVING';
                    this.log('Target set to crafting table for hoe.');
                });
                if (success) return;
            }
            if (Date.now() - this.lastRequestTime > 30000) {
                bot.chat(`I need a wooden hoe!`);
                this.lastRequestTime = Date.now();
            }
            // If we have no wood, we need to gather it.
            if (numLogs === 0 && numPlanks < 3) {
                const logBlock = bot.findBlock({
                    matching: block => block && (block.name.includes('_log') || block.name.includes('_stem')),
                    maxDistance: 32
                });
                if (logBlock && !this.failedBlocks.has(logBlock.position.toString())) {
                    this.log(`Found log at ${logBlock.position}. Targeting for wood (hoe).`);
                    this.setMovementTarget(bot, logBlock, 'GATHER_WOOD');
                    return;
                }
            }
            return;
        }

        // 2. Storage Check (Chest)
        // If we have a farm center but NO known farm chest, try to create one.
        const farmAnchor = this.getNearestPOI(bot, 'farm_center');
        const farmChest = this.getNearestPOI(bot, 'farm_chest');
        
        if (farmAnchor && !farmChest) {
            // Check if there is already a chest nearby that we just missed or hasn't been registered
            const nearbyChest = bot.findBlock({
                matching: b => ['chest', 'barrel'].includes(b.name),
                maxDistance: 8,
                point: farmAnchor.position
            });
            if (nearbyChest) {
                this.log(`Found existing chest near farm at ${nearbyChest.position}. Registering as farm_chest.`);
                this.rememberPOI('farm_chest', nearbyChest.position);
                return;
            }
            
            // Try to craft/place one
            const hasChestItem = inventory.some(i => i.name === 'chest');
            if (hasChestItem) {
                // Find a spot to place it.
                // Logic: Look for a solid block next to farm_center that is NOT farmland and has AIR above.
                const center = farmAnchor.position;
                const offsets = [
                    new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
                    new Vec3(2, 0, 0), new Vec3(-2, 0, 0), new Vec3(0, 0, 2), new Vec3(0, 0, -2)
                ];
                
                let placeTarget: any = null;
                
                for (const off of offsets) {
                    const groundPos = center.plus(off);
                    // We need groundPos to be solid, and groundPos.up to be air
                    const ground = bot.blockAt(groundPos);
                    const above = bot.blockAt(groundPos.offset(0, 1, 0));
                    
                    if (ground && ground.boundingBox === 'block' && ground.name !== 'farmland' && 
                        above && above.boundingBox === 'empty') {
                        placeTarget = ground;
                        break;
                    }
                }
                
                if (placeTarget) {
                    this.log(`Found spot to place farm chest at ${placeTarget.position} (on ${placeTarget.name}).`);
                    this.setMovementTarget(bot, placeTarget, 'PLACE_CHEST');
                    return;
                } else {
                    this.log('Could not find a valid spot to place a chest near farm center.');
                }
            } else {
                // Need to craft a chest (8 planks)
                const numPlanks = count(i => i.name.endsWith('_planks'));
                const numLogs = count(i => i.name.includes('_log') || i.name.includes('_stem'));
                
                if (numPlanks >= 8) {
                    this.log('Crafting chest...');
                    await this.tryCraft(bot, 'chest', (target) => {
                        this.targetBlock = target;
                        this.state = 'MOVING';
                    });
                    return;
                } else {
                    // Need more wood
                    const totalWoodValue = numPlanks + (numLogs * 4);
                    if (totalWoodValue < 8) {
                         // Go gather wood
                        const logBlock = bot.findBlock({
                            matching: block => block && (block.name.includes('_log') || block.name.includes('_stem')),
                            maxDistance: 32
                        });
                        if (logBlock && !this.failedBlocks.has(logBlock.position.toString())) {
                            this.log(`Found log at ${logBlock.position}. Targeting for wood (chest).`);
                            this.setMovementTarget(bot, logBlock, 'GATHER_WOOD');
                            return;
                        }
                    } else {
                        // Have logs, turn to planks
                        const logItem = inventory.find(i => i.name.includes('_log') || i.name.includes('_stem'));
                        if (logItem) {
                            const plankName = logItem.name.replace('_log', '_planks').replace('_stem', '_planks');
                            this.log(`Crafting planks from ${logItem.name} for chest...`);
                            await this.tryCraft(bot, plankName, (target) => {
                                this.targetBlock = target;
                                this.state = 'MOVING';
                            });
                            return;
                        }
                    }
                }
            }
        }

        // 3. Seed Alert
        const seeds = inventory.filter(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
        );
        if (seeds.length === 0) {
            const harvestable = bot.findBlock({
                matching: (block) => this.isMature(block),
                maxDistance: 32,
                useExtraInfo: true
            });
            if (!harvestable && Date.now() - this.lastRequestTime > 30000) {
                bot.chat("I'm out of seeds and there's nothing to harvest!");
                this.lastRequestTime = Date.now();
            }
        }
    }

    private async findSeedsNearby(bot: Bot): Promise<boolean> {
        // 1. Search for grass
        const grass = bot.findBlock({
            matching: block => {
                if (!block) return false;
                const name = block.name;
                // Support both old and new names (e.g., 'short_grass' in 1.20.3+)
                return name === 'grass' || name === 'tall_grass' || name === 'short_grass' || name === 'fern' || name === 'large_fern';
            },
            maxDistance: 32
        });
        if (grass && !this.failedBlocks.has(grass.position.toString())) {
            this.log(`Found grass at ${grass.position}. Gathering seeds...`);
            this.setMovementTarget(bot, grass, 'GATHER_SEEDS');
            return true;
        }

        // 2. Search for containers
        const storage = bot.findBlock({
            matching: block => {
                if (!block || !block.position) return false;
                if (!['chest', 'barrel', 'trapped_chest'].includes(block.name)) return false;
                
                const posStr = block.position.toString();
                // Check hard failures (pathing/broken)
                if (this.failedBlocks.has(posStr)) {
                     const failedAt = this.failedBlocks.get(posStr)!;
                     if (Date.now() - failedAt < this.RETRY_COOLDOWN) return false;
                }
                // Check soft failures (empty/checked recently)
                if (this.containerCooldowns.has(posStr)) {
                     const checkedAt = this.containerCooldowns.get(posStr)!;
                     if (Date.now() - checkedAt < this.CONTAINER_COOLDOWN) return false;
                }
                return true;
            },
            maxDistance: 32
        });
        
        if (storage) {
            this.log(`Found ${storage.name} at ${storage.position}. Checking for seeds...`);
            this.setMovementTarget(bot, storage, 'CHECK_STORAGE');
            return true;
        }

        return false;
    }
    
    // Deposit Helpers
    private shouldDeposit(bot: Bot): boolean {
        if (!bot.inventory) return false;
        
        // 1. Inventory Fullness (empty slots < 3)
        if (bot.inventory.emptySlotCount() < 3) return true;
        
        // 2. Check for abundance of produce (more than 2 stacks of any crop)
        const produce = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'];
        for (const name of produce) {
            const count = bot.inventory.items().filter(i => i.name === name).reduce((sum, i) => sum + i.count, 0);
            if (count > 128) return true;
        }
        
        // 3. Too many seeds?
        const seedNames = ['wheat_seeds', 'beetroot_seeds'];
        for (const name of seedNames) {
            const count = bot.inventory.items().filter(i => i.name === name).reduce((sum, i) => sum + i.count, 0);
            if (count > 128) return true;
        }
        
        return false;
    }
    
    private async findDepositTarget(bot: Bot, farmAnchor: any): Promise<boolean> {
        // 1. Check for known farm chest
        const knownChest = this.getNearestPOI(bot, 'farm_chest');
        if (knownChest) {
            const dist = bot.entity.position.distanceTo(knownChest.position);
            // Verify if block is still a chest
            const block = bot.blockAt(knownChest.position);
            if (block && ['chest', 'barrel', 'trapped_chest'].includes(block.name)) {
                this.log(`Going to known farm chest at ${knownChest.position} (${dist.toFixed(1)}m)`);
                this.setMovementTarget(bot, block, 'DEPOSIT_ITEMS');
                return true;
            } else {
                this.forgetPOI('farm_chest', knownChest.position);
            }
        }
        
        // 2. Find closest chest to FARM CENTER (if exists), else Bot
        const searchPoint = farmAnchor ? farmAnchor.position : bot.entity.position;
        const chest = bot.findBlock({
            matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
            maxDistance: 32,
            point: searchPoint
        });
        
        if (chest) {
            this.log(`Found new candidate for farm chest at ${chest.position}.`);
            this.setMovementTarget(bot, chest, 'DEPOSIT_ITEMS');
            return true;
        }
        
        return false;
    }
}