import type { Bot } from 'mineflayer';
import type { Role } from './Role';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear } = goals;

export class FarmingRole implements Role {
    name = 'farming';
    private active = false;
    private targetBlock: any = null;
    private state: 'IDLE' | 'FINDING' | 'MOVING' | 'ACTING' | 'COLLECTING' = 'IDLE';
    private lastActionTime = 0;

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
        if (!this.active || !bot.entity) return;

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
        }
    }

    private async findTask(bot: Bot) {
        // 1. Find mature crops to harvest
        const harvestable = bot.findBlock({
            matching: (block) => {
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
                if (block.name !== 'farmland') return false;
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
                    if (block.name !== 'grass_block' && block.name !== 'dirt') return false;
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

        // No tasks found, wait a bit
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
            if (['wheat', 'carrots', 'potatoes', 'beetroots'].includes(block.name)) {
                // Harvest
                await bot.dig(block);
                this.state = 'COLLECTING';
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
            if (cropName === 'beetroot_seeds') cropName = 'beetroots';

            if (!neighborCrops.includes(cropName)) {
                return seed.name;
            }
        }

        return availableSeeds[0]?.name ?? null;
    }
}
