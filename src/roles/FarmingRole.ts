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
    private isUpdating = false;

    start(bot: Bot) {
        this.active = true;
        this.state = 'FINDING';
        bot.chat('🌾 Starting farming...');
    }

    stop(bot: Bot) {
        this.active = false;
        this.state = 'IDLE';
        this.targetBlock = null;
        bot.pathfinder.setGoal(null);
        bot.chat('🛑 Stopped farming.');
    }

    async update(bot: Bot) {
        if (!this.active || !bot.entity || this.isUpdating) return;
        this.isUpdating = true;
        try {
            switch (this.state) {
                case 'FINDING':
                    await this.findTask(bot);
                    break;
                case 'MOVING':
                    // Pathfinder handles movement, we wait for goal reached or check if target is near
                    if (this.targetBlock && bot.entity?.position && bot.entity.position.distanceTo(this.targetBlock.position) < 2) {
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
                    // Crafting logic would go here, for now it will transition back via checkNeeds
                    break;
            }
        } finally {
            this.isUpdating = false;
        }
    }

    private async findTask(bot: Bot) {
        // 1. Find mature crops to harvest
        const harvestable = bot.findBlock({
            matching: (block) => {
                if (!block) return false;
                const names = ['wheat', 'carrots', 'potatoes', 'beetroots'];
                if (!names.includes(block.name)) return false;
                const metadata = block.metadata as any;
                return (block.name === 'beetroots') ? metadata === 3 : metadata === 7;
            },
            maxDistance: 16
        });

        if (harvestable) {
            this.targetBlock = harvestable;
            this.state = 'MOVING';
            bot.pathfinder.setGoal(new GoalNear(harvestable.position.x, harvestable.position.y, harvestable.position.z, 1));
            return;
        }

        // 2. Find empty farmland to plant
        const emptyFarmlands = bot.findBlocks({
            matching: (block) => {
                if (!block || !block.position || block.name !== 'farmland') return false;
                const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
                if (!blockAbove || blockAbove.name !== 'air') return false;

                // Check light level (must be >= 9)
                if (blockAbove.light < 9) return false;

                return true;
            },
            maxDistance: 16,
            count: 10
        });

        if (emptyFarmlands.length > 0) {
            // Sort by hydration and distance
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

            if (bestFarmland && this.getOptimalCrop(bot, bestFarmland.position)) {
                this.targetBlock = bestFarmland;
                this.state = 'MOVING';
                bot.pathfinder.setGoal(new GoalNear(bestFarmland.position.x, bestFarmland.position.y, bestFarmland.position.z, 1));
                return;
            }
        }

        // 3. Find dirt/grass to till (if we have a hoe)
        const hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        if (hoe) {
            const tillable = bot.findBlocks({
                matching: (block) => {
                    if (!block || !block.position || (block.name !== 'grass_block' && block.name !== 'dirt')) return false;
                    const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
                    return !!(blockAbove && blockAbove.name === 'air');
                },
                maxDistance: 8,
                count: 10
            });

            if (tillable.length > 0) {
                const bestTillable = tillable
                    .map(pos => bot.blockAt(pos)!)
                    .sort((a, b) => {
                        const aHydrated = this.isHydrated(bot, a.position) ? 1 : 0;
                        const bHydrated = this.isHydrated(bot, b.position) ? 1 : 0;
                        if (aHydrated !== bHydrated) return bHydrated - aHydrated;
                        const botPos = bot.entity?.position;
                        if (!botPos) return 0;
                        return botPos.distanceTo(a.position) - botPos.distanceTo(b.position);
                    })[0];

                if (bestTillable) {
                    this.targetBlock = bestTillable;
                    this.state = 'MOVING';
                    bot.pathfinder.setGoal(new GoalNear(bestTillable.position.x, bestTillable.position.y, bestTillable.position.z, 1));
                    return;
                }
            }
        }

        // No tasks found, check if we need anything
        await this.checkNeeds(bot);
        this.state = 'IDLE';
        setTimeout(() => { if (this.active) this.state = 'FINDING'; }, 2000);
    }

    private async performAction(bot: Bot) {
        if (!this.targetBlock) {
            this.state = 'FINDING';
            return;
        }

        const block = bot.blockAt(this.targetBlock.position);
        if (!block) {
            this.state = 'FINDING';
            return;
        }

        this.lastActionTime = Date.now();

        try {
            if (this.craftingItem) {
                const success = await this.performCraftingAction(bot, block);
                if (success) {
                    this.state = 'FINDING';
                } else {
                    this.state = 'FINDING'; // Reset even if failed to avoid loop
                }
                return;
            }

            if (['wheat', 'carrots', 'potatoes', 'beetroots'].includes(block.name)) {
                // Harvest
                try {
                    await bot.dig(block);
                    this.state = 'COLLECTING';
                } catch (err: any) {
                    if (err.message === 'Digging aborted') {
                        this.state = 'FINDING'; // Reset to finding if aborted
                    } else {
                        throw err;
                    }
                }
            } else if (block.name === 'farmland') {
                // Plant
                const cropToPlant = this.getOptimalCrop(bot, block.position);
                if (cropToPlant) {
                    const seedItem = bot.inventory.items().find(item => item.name === cropToPlant);
                    if (seedItem) {
                        await bot.equip(seedItem, 'hand');
                        await bot.placeBlock(block, new Vec3(0, 1, 0));
                    }
                }
                this.state = 'FINDING';
            } else if (block.name === 'grass_block' || block.name === 'dirt') {
                // Till
                const hoe = bot.inventory.items().find(item => item.name.includes('_hoe'));
                if (hoe) {
                    await bot.equip(hoe, 'hand');
                    await bot.activateBlock(block);
                }
                this.state = 'FINDING';
            }
        } catch (err) {
            console.error('Error performing action:', err);
            this.state = 'FINDING';
        }
    }

    private async collectItems(bot: Bot) {
        if (!bot.entity) return;
        const botPos = bot.entity.position;
        const itemEntity = bot.nearestEntity(entity =>
            entity.name === 'item' &&
            botPos.distanceTo(entity.position) < 4
        );

        if (itemEntity) {
            bot.pathfinder.setGoal(new GoalNear(itemEntity.position.x, itemEntity.position.y, itemEntity.position.z, 0.5));
        } else {
            this.state = 'FINDING';
        }

        // Timeout if stuck
        if (Date.now() - this.lastActionTime > 5000) {
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
            // Check for materials
            const planks = inventory.find(item => item.name.endsWith('_planks'));
            const sticks = inventory.find(item => item.name === 'stick');
            const logs = inventory.find(item => item.name.includes('_log') || item.name.includes('_stem'));

            if (!planks && logs) {
                await this.tryCraft(bot, logs.name.replace('_log', '_planks').replace('_stem', '_planks'));
                return;
            }

            if (!sticks && planks) {
                await this.tryCraft(bot, 'stick');
                return;
            }

            // If we have materials, try to craft a hoe
            const canCraftHoe = this.canCraft(bot, 'wooden_hoe');
            if (canCraftHoe) {
                await this.tryCraft(bot, 'wooden_hoe', (target) => {
                    this.targetBlock = target;
                    this.state = 'MOVING';
                });
            } else if (Date.now() - this.lastRequestTime > 30000) {
                bot.chat("I need a hoe! I have some materials but maybe not enough or I'm missing something.");
                this.lastRequestTime = Date.now();
            }
            return;
        }

        if (seeds.length === 0) {
            const harvestable = bot.findBlock({
                matching: (block) => {
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
