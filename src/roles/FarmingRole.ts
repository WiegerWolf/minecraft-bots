import type { Bot } from 'mineflayer';
import type { Role } from './Role';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear } = goals;

export class FarmingRole implements Role {
    name = 'farming';
    private active = false;
    private targetBlock: any = null;
    private state: 'IDLE' | 'FINDING' | 'MOVING' | 'ACTING' = 'IDLE';

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
        if (!this.active) return;

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
        }
    }

    private async findTask(bot: Bot) {
        // 1. Find mature crops to harvest
        const harvestable = bot.findBlock({
            matching: (block) => {
                if (block.name === 'wheat' || block.name === 'carrots' || block.name === 'potatoes') {
                    return (block.metadata as any) === 7;
                }
                if (block.name === 'beetroots') {
                    return (block.metadata as any) === 3;
                }
                return false;
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
        const seeds = bot.inventory.items().find(item => item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato');
        if (seeds) {
            const emptyFarmland = bot.findBlock({
                matching: (block) => {
                    if (block.name === 'farmland') {
                        if (!block.position) return true; // Palette check, assume maybe
                        const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
                        return !!(blockAbove && blockAbove.name === 'air');
                    }
                    return false;
                },
                maxDistance: 16
            });

            if (emptyFarmland) {
                this.targetBlock = emptyFarmland;
                this.state = 'MOVING';
                bot.pathfinder.setGoal(new GoalNear(emptyFarmland.position.x, emptyFarmland.position.y, emptyFarmland.position.z, 1));
                return;
            }
        }

        // 3. Find dirt/grass to till (if we have a hoe)
        const hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        if (hoe) {
            const tillable = bot.findBlock({
                matching: (block) => {
                    if (block.name === 'grass_block' || block.name === 'dirt') {
                        if (!block.position) return true; // Palette check, assume maybe
                        const blockAbove = bot.blockAt(block.position.offset(0, 1, 0));
                        return !!(blockAbove && blockAbove.name === 'air');
                    }
                    return false;
                },
                maxDistance: 8 // Reduced distance for tilling to avoid wandering too far
            });

            if (tillable) {
                this.targetBlock = tillable;
                this.state = 'MOVING';
                bot.pathfinder.setGoal(new GoalNear(tillable.position.x, tillable.position.y, tillable.position.z, 1));
                return;
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

        try {
            if (['wheat', 'carrots', 'potatoes', 'beetroots'].includes(block.name)) {
                // Harvest
                await bot.dig(block);
                this.state = 'FINDING';
            } else if (block.name === 'farmland') {
                // Plant
                const seeds = bot.inventory.items().find(item => item.name.includes('seeds') || item.name === 'carrot' || item.name === 'potato');
                if (seeds) {
                    await bot.equip(seeds, 'hand');
                    await bot.placeBlock(block, new Vec3(0, 1, 0));
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
}
