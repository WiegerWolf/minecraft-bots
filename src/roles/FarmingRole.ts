import type { Bot } from 'mineflayer';
import type { Role } from './Role';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { CraftingMixin } from './mixins/CraftingMixin';
const minecraftData = require('minecraft-data');

const { GoalNear } = goals;

export class FarmingRole extends CraftingMixin(class { }) implements Role {
    name = 'farming';
    private active = false;
    private targetBlock: any = null;
    private state: 'IDLE' | 'FINDING' | 'MOVING' | 'ACTING' | 'COLLECTING' | 'CRAFTING' = 'IDLE';
    private lastActionTime = 0;
    private lastLogTime = 0;
    private lastPlanTime = 0;
    private isUpdating = false;
    private failedBlocks: Set<string> = new Set();

    // Fix 1: Movement timeout tracking
    private movementStartTime: number = 0;
    private readonly MOVEMENT_TIMEOUT = 30000; // 30 seconds

    // Fix 3: Collection tracking
    private collectionStartTime: number = 0;
    private readonly COLLECTION_TIMEOUT = 10000; // 10 seconds

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

        // Fix 2: Set up pathfinder event handlers
        this.boundOnGoalReached = this.onGoalReached.bind(this);
        this.boundOnPathUpdate = this.onPathUpdate.bind(this);
        bot.on('goal_reached', this.boundOnGoalReached);
        bot.on('path_update', this.boundOnPathUpdate);

        bot.chat('🌾 Starting farming...');
        this.log('Started farming role.');
    }

    stop(bot: Bot) {
        this.active = false;
        this.state = 'IDLE';
        this.targetBlock = null;
        this.failedBlocks.clear();

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
                this.failedBlocks.add(this.targetBlock.position.toString());
            }
            this.targetBlock = null;
            this.intention = 'NONE';
            this.state = 'FINDING';
        }
    }

    private intention: 'NONE' | 'HARVEST' | 'PLANT' | 'TILL' | 'MAKE_WATER' | 'GATHER_WOOD' = 'NONE';
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
                            this.failedBlocks.add(this.targetBlock.position.toString());
                        }
                        this.targetBlock = null;
                        this.intention = 'NONE';
                        bot.pathfinder.setGoal(null);
                        this.state = 'FINDING';
                        break;
                    }

                    // Original distance check (kept as backup for goal_reached event)
                    if (this.targetBlock && bot.entity?.position && bot.entity.position.distanceTo(this.targetBlock.position) < 2.5) {
                        this.log('Reached target. Switching to ACTING.');
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

    // Helper to set movement target and start movement timer
    private setMovementTarget(bot: Bot, block: any, intention: 'HARVEST' | 'PLANT' | 'TILL' | 'MAKE_WATER' | 'GATHER_WOOD', goalRange: number = 1) {
        this.targetBlock = block;
        this.intention = intention;
        this.state = 'MOVING';
        this.movementStartTime = Date.now(); // Fix 1: Track when movement started
        bot.pathfinder.setGoal(new GoalNear(block.position.x, block.position.y, block.position.z, goalRange));
    }

    // Fix 4: Validate that the block matches what we expect for our intention
    private validateBlockForIntention(block: any): boolean {
        if (!block) return false;

        switch (this.intention) {
            case 'HARVEST':
                // Must be a mature crop
                const cropNames = ['wheat', 'carrots', 'potatoes', 'beetroots'];
                if (!cropNames.includes(block.name)) return false;
                const metadata = block.metadata as any;
                return (block.name === 'beetroots') ? metadata === 3 : metadata === 7;

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

    private async findTask(bot: Bot) {
        // 1. Find mature crops to harvest
        const now = Date.now();
        const shouldLog = now - this.lastLogTime > 10000; // Log status every 10s if idle

        if (shouldLog) {
            this.log('Checking for tasks...');
            this.lastLogTime = now;
        }
        const harvestable = bot.findBlock({
            matching: (block) => {
                if (!block || !block.position) return false;
                // Fix 4: Skip blocks that have failed before
                if (this.failedBlocks.has(block.position.toString())) return false;
                const names = ['wheat', 'carrots', 'potatoes', 'beetroots'];
                if (!names.includes(block.name)) return false;
                const metadata = block.metadata as any;
                return (block.name === 'beetroots') ? metadata === 3 : metadata === 7;
            },
            maxDistance: 16
        });

        if (harvestable) {
            this.log(`Found harvestable ${harvestable.name} at ${harvestable.position}. Moving...`);
            this.setMovementTarget(bot, harvestable, 'HARVEST');
            return;
        }

        // 2. Find empty farmland to plant
        const emptyFarmlands = bot.findBlocks({
            matching: (block) => {
                if (!block || !block.position || block.name !== 'farmland') return false;
                // Fix 4: Skip blocks that have failed before
                if (this.failedBlocks.has(block.position.toString())) return false;
                const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
                if (!blockAbove || blockAbove.name !== 'air') return false;
                if (blockAbove.light < 9) return false;
                return true;
            },
            maxDistance: 16,
            count: 10
        });

        if (emptyFarmlands.length > 0) {
            const bestFarmland = emptyFarmlands
                .map(pos => bot.blockAt(pos)!)
                .sort((a, b) => {
                    const aHydrated = this.isHydrated(bot, a.position) ? 1 : 0;
                    const bHydrated = this.isHydrated(bot, b.position) ? 1 : 0;
                    if (aHydrated !== bHydrated) return bHydrated - aHydrated;
                    const botPos = bot.entity?.position;
                    if (!botPos) return 0;
                    return botPos.distanceTo(a.position) - botPos.distanceTo(b.position);
                })[0];

            if (bestFarmland) {
                const cropToPlant = this.getOptimalCrop(bot, bestFarmland.position);
                if (cropToPlant) {
                    this.log(`Found farmland at ${bestFarmland.position}. Plan to plant ${cropToPlant}. Moving...`);
                    this.setMovementTarget(bot, bestFarmland, 'PLANT');
                    return;
                }
            }
        }

        // 3. Find dirt/grass to till (if we have a hoe)
        const hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        if (hoe) {
            this.log(`Hoe found: ${hoe.name}. Looking for existing tillable blocks near water...`);

            // Prioritize blocks near existing farmland or water first
            const tillable = bot.findBlocks({
                matching: (block) => {
                    if (!block || !block.position) return false;
                    if (this.failedBlocks.has(block.position.toString())) return false; // Skip failed blocks
                    const isDirtOrGrass = block.name === 'grass_block' || block.name === 'dirt';
                    if (!isDirtOrGrass) return false;
                    const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
                    const isAirAbove = !!(blockAbove && blockAbove.name === 'air');
                    return isDirtOrGrass && isAirAbove && this.isHydrated(bot, block.position); // Only valid if hydrated already
                },
                maxDistance: 16,
                count: 10
            });

            if (tillable.length > 0) {
                const bestTillable = tillable.map(pos => bot.blockAt(pos)!).sort((a, b) => {
                    const botPos = bot.entity?.position;
                    if (!botPos) return 0;
                    return botPos.distanceTo(a.position) - botPos.distanceTo(b.position);
                })[0];

                if (bestTillable) {
                    this.log(`Found tillable ground (hydrated) at ${bestTillable.position}. Moving...`);
                    this.setMovementTarget(bot, bestTillable, 'TILL');
                    return;
                }
            }
        }

        // 4. If no immediate tasks, try to plan a new field (find water or make it)
        await this.planField(bot);
        if (this.state !== 'FINDING' && this.state !== 'IDLE') return; // planField might have set state

        // 5. Check needs (crafting etc)
        await this.checkNeeds(bot);

        // 6. If still no hoe, try to gather wood
        if (this.state === 'FINDING') {
            const inventory = bot.inventory.items();
            const hasHoe = inventory.some(item => item.name.includes('hoe'));
            const logs = inventory.filter(i => i.name.includes('_log') || i.name.includes('_stem'));
            const planks = inventory.filter(i => i.name.endsWith('_planks'));

            if (!hasHoe && logs.length === 0 && planks.length < 3) {
                const logBlock = bot.findBlock({
                    matching: block => block && (block.name.includes('_log') || block.name.includes('_stem')),
                    maxDistance: 16
                });
                if (logBlock && !this.failedBlocks.has(logBlock.position.toString())) {
                    this.log(`Found log at ${logBlock.position}. Moving to gather wood.`);
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
        if (now - this.lastPlanTime < 10000) return; // Only plan every 10s
        this.lastPlanTime = now;

        this.log('Planning mode: Searching for water or suitable farm location...');

        // Check if we have a hoe - can't till without one
        const inventory = bot.inventory.items();
        const hoe = inventory.find(item => item.name.includes('hoe'));
        const seeds = inventory.filter(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
        );

        if (!hoe || seeds.length === 0) {
            return;
        }

        // Strategy A: Find existing water
        const waterBlock = bot.findBlock({
            matching: block => block && (block.name === 'water' || block.name === 'flowing_water'),
            maxDistance: 32
        });

        if (waterBlock) {
            // Check for tillable land within hydration range (4 blocks)
            for (let x = -4; x <= 4; x++) {
                for (let z = -4; z <= 4; z++) {
                    if (x === 0 && z === 0) continue;

                    const pos = waterBlock.position.offset(x, 0, z);
                    if (this.failedBlocks.has(pos.toString())) continue;

                    const block = bot.blockAt(pos);
                    const above = bot.blockAt(pos.offset(0, 1, 0));

                    if (block && (block.name === 'grass_block' || block.name === 'dirt') && above && above.name === 'air') {
                        this.log(`Found water at ${waterBlock.position}. Targeting land at ${pos} within hydration range.`);
                        this.setMovementTarget(bot, block, 'TILL');
                        return;
                    }
                }
            }
        }

        // Strategy B: Create water source
        const waterBucket = bot.inventory.items().find(i => i.name === 'water_bucket');
        if (waterBucket) {
            this.log('Have water bucket. Looking for a spot to dig a hole for water...');
            // Find a flat spot (dirt/grass)
            const flatSpot = bot.findBlock({
                matching: block => block && (block.name === 'grass_block' || block.name === 'dirt'),
                maxDistance: 16,
                useExtraInfo: (block) => {
                    const above = bot.blockAt(block.position.offset(0, 1, 0));
                    return !!(above && above.name === 'air');
                }
            });

            if (flatSpot) {
                this.log(`Found spot for water source at ${flatSpot.position}. Moving to dig...`);
                this.setMovementTarget(bot, flatSpot, 'MAKE_WATER', 2); // Stand nearby, not on top
                return;
            }
        } else {
            // Don't spam request
            if (Date.now() - this.lastRequestTime > 30000) {
                // Check if we are totally dry (no crops, no water)
                const crops = bot.findBlock({ matching: b => b && ['wheat', 'carrots', 'potatoes', 'beetroots'].includes(b.name), maxDistance: 32 });
                if (!crops && !waterBlock) {
                    bot.chat("I can't find any water or farms! If you give me a water bucket, I can make a farm.");
                    this.lastRequestTime = Date.now();
                }
            }
        }
    }

    private async performAction(bot: Bot) {
        if (!this.targetBlock) {
            this.state = 'FINDING';
            return;
        }

        const block = bot.blockAt(this.targetBlock.position);
        if (!block) {
            this.log('Target block no longer exists. Back to FINDING.');
            this.state = 'FINDING';
            return;
        }

        // Fix 4: Validate block type matches our intention before acting
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
                const success = await this.performCraftingAction(bot, block);
                // Keep creating/finding until done
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
                    } else {
                        throw err;
                    }
                }
            } else if (this.intention === 'PLANT') {
                const cropToPlant = this.getOptimalCrop(bot, block.position);
                if (cropToPlant) {
                    const seedItem = bot.inventory.items().find(item => item.name === cropToPlant);
                    if (seedItem) {
                        await bot.equip(seedItem, 'hand');
                        await bot.placeBlock(block, new Vec3(0, 1, 0));
                        this.log(`Planted ${cropToPlant}.`);
                    }
                }
                this.state = 'FINDING';
            } else if (this.intention === 'TILL') {
                const hoe = bot.inventory.items().find(item => item.name.includes('_hoe'));
                if (hoe) {
                    await bot.equip(hoe, 'hand');
                    await bot.activateBlock(block);
                    this.log(`Tilled ${block.name} at ${block.position}. Verifying...`);

                    // Wait briefly for server update
                    await new Promise(resolve => setTimeout(resolve, 500));

                    const updatedBlock = bot.blockAt(block.position);
                    if (updatedBlock && updatedBlock.name === 'farmland') {
                        this.log('Verification success: Block is now farmland.');
                        // Success! Ensure it's not in failedBlocks (unlikely if we just picked it, but good practice)
                        if (this.failedBlocks.has(block.position.toString())) {
                            this.failedBlocks.delete(block.position.toString());
                        }
                    } else {
                        this.log(`Verification failed: Block is ${updatedBlock?.name}, not farmland. Blacklisting ${block.position}.`);
                        this.failedBlocks.add(block.position.toString());
                    }
                } else {
                    this.log('No hoe found for tilling.');
                }
                this.state = 'FINDING';
            } else if (this.intention === 'MAKE_WATER') {
                // 1. Dig the block
                this.log('Digging hole for water...');
                const shovel = bot.inventory.items().find(i => i.name.includes('shovel'));
                if (shovel) await bot.equip(shovel, 'hand');

                await bot.dig(block);

                // 2. Place water
                // We need to place it against a solid face.
                // Since we dug 'block', it is now air.
                // We can place against the block BELOW it.
                const blockBelow = bot.blockAt(block.position.offset(0, -1, 0));

                const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
                if (bucket && blockBelow) {
                    this.log('Placing water bucket...');
                    await bot.equip(bucket, 'hand');
                    await bot.placeBlock(blockBelow, new Vec3(0, 1, 0)); // Place on top of the block below
                    this.log('Water source created!');
                } else {
                    this.log('Failed to place water (missing bucket or block below).');
                }
                this.state = 'FINDING';
            } else if (this.intention === 'GATHER_WOOD') {
                this.log('Gathering wood...');
                await bot.dig(block);
                this.log('Wood gathered.');
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

        // Fix 3: Initialize collection start time if not set
        if (this.collectionStartTime === 0) {
            this.collectionStartTime = Date.now();
        }

        const botPos = bot.entity.position;
        const itemEntity = bot.nearestEntity(entity =>
            entity.name === 'item' &&
            botPos.distanceTo(entity.position) < 6 // Increased range slightly
        );

        if (itemEntity) {
            // Only set a new goal if we're not already moving toward an item
            const currentGoal = bot.pathfinder.goal;
            if (!currentGoal) {
                bot.pathfinder.setGoal(new GoalNear(itemEntity.position.x, itemEntity.position.y, itemEntity.position.z, 0.5));
            }
        } else {
            this.log('No items to collect nearby. Back to FINDING.');
            this.collectionStartTime = 0; // Reset for next collection
            this.state = 'FINDING';
            return;
        }

        // Fix 3: Use dedicated collection timeout
        if (Date.now() - this.collectionStartTime > this.COLLECTION_TIMEOUT) {
            this.log('Collecting timed out. Back to FINDING.');
            this.collectionStartTime = 0; // Reset for next collection
            bot.pathfinder.setGoal(null); // Stop trying to collect
            this.state = 'FINDING';
        }
    }

    private isHydrated(bot: Bot, position: Vec3): boolean {
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                for (let y = -1; y <= 1; y++) {
                    const block = bot.blockAt(position.offset(x, y, z));
                    if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private getOptimalCrop(bot: Bot, position: Vec3): string | null {
        const inventory = bot.inventory.items();
        const availableSeeds = inventory.filter(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
        );

        if (availableSeeds.length === 0) return null;

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
            if (cropName === 'beetroot') cropName = 'beetroots'; // Fix pluralization
            if (cropName === 'carrot') cropName = 'carrots';
            if (cropName === 'potato') cropName = 'potatoes';

            if (!neighborCrops.includes(cropName)) {
                return seed.name;
            }
        }

        // If all neighbors are the same, just return the first available seed
        return availableSeeds[0]?.name ?? null;
    }

    private async checkNeeds(bot: Bot) {
        const inventory = bot.inventory.items();
        const hasHoe = inventory.some(item => item.name.includes('hoe'));
        const seeds = inventory.filter(item =>
            item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato' || item.name === 'beetroot'
        );

        if (!hasHoe) {
            // Check for materials with quantity awareness
            // Standard Wooden Hoe recipe: 2 Sticks, 3 Planks (any wood)

            // Helper to count items matching a predicate
            const count = (predicate: (item: any) => boolean) =>
                inventory.filter(predicate).reduce((acc, item) => acc + item.count, 0);

            const numSticks = count(i => i.name === 'stick');
            const numPlanks = count(i => i.name.endsWith('_planks'));
            const numLogs = count(i => i.name.includes('_log') || i.name.includes('_stem'));

            // Strategy: Ensure we have enough planks for our immediate needs (sticks + hoe)
            // If we lack sticks (need 2), we need 2 planks to make them.
            // If we lack planks for the hoe (need 3) OR for the sticks (need 2), we should craft planks from logs.

            // 1. Try to craft planks if we're low on planks or need them for sticks
            // We need 3 planks for hoe. If we need sticks, we need +2 planks.
            const planksNeeded = 3 + (numSticks < 2 ? 2 : 0);

            if (numPlanks < planksNeeded && numLogs > 0) {
                const logItem = inventory.find(i => i.name.includes('_log') || i.name.includes('_stem'));
                if (logItem) {
                    const plankName = logItem.name.replace('_log', '_planks').replace('_stem', '_planks');
                    // Craft planks from logs
                    this.log(`Crafting planks from ${logItem.name}...`);
                    await this.tryCraft(bot, plankName, (target) => {
                        this.targetBlock = target;
                        this.state = 'MOVING';
                    });
                    return;
                }
            }

            // 2. Try to craft sticks if we don't have enough (need 2)
            if (numSticks < 2 && numPlanks >= 2) {
                this.log('Crafting sticks...');
                await this.tryCraft(bot, 'stick', (target) => {
                    this.targetBlock = target;
                    this.state = 'MOVING';
                });
                return;
            }

            // 3. If we have materials, try to craft a hoe
            // Note: canCraft check should pass now if we have items, OR if we have table logic fixed
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
                bot.chat(`I need a wooden hoe! I have ${numLogs} logs, ${numPlanks} planks, ${numSticks} sticks. Missing something or a table?`);
                this.lastRequestTime = Date.now();
            }
            return;
        }

        if (seeds.length === 0) {
            const harvestable = bot.findBlock({
                matching: (block) => {
                    if (!block) return false;
                    const names = ['wheat', 'carrots', 'potatoes', 'beetroots'];
                    if (!names.includes(block.name)) return false;
                    const metadata = block.metadata as any;
                    return (block.name === 'beetroots') ? metadata === 3 : metadata === 7;
                },
                maxDistance: 32
            });

            if (!harvestable && Date.now() - this.lastRequestTime > 30000) {
                bot.chat("I'm out of seeds and there's nothing to harvest! I need some seeds, carrots, or potatoes please.");
                this.lastRequestTime = Date.now();
            }
        }
    }
}
