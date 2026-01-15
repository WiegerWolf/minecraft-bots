import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock, GoalNear } = goals;

export class LogisticsTask implements Task {
    name = 'logistics';
    private readonly MAX_SEEDS_TO_KEEP = 64;
    private readonly MIN_SEEDS_TO_START_FARMING = 3;
    private readonly CONTAINER_COOLDOWN = 60000;

    // ... (findWork method remains the same)
    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const emptySlots = bot.inventory.emptySlotCount();

        const seedCount = inventory
            .filter(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name))
            .reduce((sum, item) => sum + item.count, 0);

        const hasProduce = inventory.some(item =>
            ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'].includes(item.name)
        );
        const hasHoe = inventory.some(i => i.name.includes('hoe'));

        const isFull = emptySlots < 3;
        // Only deposit produce if we are full OR if we have excess produce AND no active seed gathering needed
        const shouldDeposit = isFull || (hasProduce && seedCount >= this.MIN_SEEDS_TO_START_FARMING);

        // 1. Deposit / Restock
        if (shouldDeposit) {
            const chest = await this.findChest(bot, role);
            if (chest) {
                return {
                    priority: isFull ? 100 : 80,
                    description: isFull ? 'Inventory Full - Depositing' : 'Restocking/Depositing',
                    target: chest,
                    range: 3.0,
                    task: this
                };
            }
        }

        // 2. Scavenge Grass for Seeds
        // If we have < 3 seeds, we WANT more, but if we have at least 1, we can farm.
        if (seedCount < this.MIN_SEEDS_TO_START_FARMING) {
            // High priority if completely empty. Medium if just topping up.
            const priority = (seedCount === 0 && hasHoe) ? 60 : 35;

            const targetPlants = ['grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'wheat', 'dead_bush'];
            const grass = role.findNaturalBlock(bot, targetPlants, { maxDistance: 48 });

            if (grass) {
                return {
                    priority: priority,
                    description: `Gathering seeds from ${grass.name} (${seedCount}/${this.MIN_SEEDS_TO_START_FARMING})`,
                    target: grass,
                    task: this
                };
            }
            else {
                // Only force exploration if we have ZERO seeds.
                // If we have 1 or 2, we return null so the bot proceeds to Tilling/Planting what it has.
                return {
                    priority: 25,
                    description: "Exploring to find grass/seeds...",
                    target: null,
                    task: this
                };
            }
        }

        return null;
    }

    // perform method remains unchanged
    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) {
            await role.wanderNewChunk(bot);
            return;
        }

        if (target.name.includes('grass') || target.name.includes('fern') || target.name === 'dead_bush') {
            try {
                await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 1));
                bot.pathfinder.stop();
                bot.pathfinder.setGoal(null);

                // Clear obstructions before digging
                if (!bot.canDigBlock(target)) {
                    await role.clearObstructions(bot);
                }

                await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
                if (bot.canDigBlock(target)) {
                    await bot.dig(target);
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    role.blacklistBlock(target.position);
                }
            } catch (err) {
                role.blacklistBlock(target.position);
            }
            return;
        }

        if (target.name.includes('chest') || target.name.includes('barrel') || target.name.includes('shulker')) {
            try { await bot.pathfinder.goto(new GoalLookAtBlock(target.position, bot.world)); } catch (e) { }
            const container = await bot.openContainer(target);
            const inventory = bot.inventory.items();
            const containerItems = container.items();
            let didAnything = false;

            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin', 'poisonous_potato'];
            for (const item of inventory) {
                const isCrop = crops.includes(item.name);
                const isSeed = item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name);
                if (isCrop || isSeed) {
                    await container.deposit(item.type, null, item.count);
                    didAnything = true;
                }
            }
            const seedNames = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
            for (const name of seedNames) {
                const currentCount = bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                if (currentCount < this.MAX_SEEDS_TO_KEEP) {
                    const chestItem = containerItems.find(i => i.name === name);
                    if (chestItem) {
                        const needed = this.MAX_SEEDS_TO_KEEP - currentCount;
                        const toWithdraw = Math.min(needed, chestItem.count);
                        await container.withdraw(chestItem.type, null, toWithdraw);
                        didAnything = true;
                    }
                }
            }
            container.close();
            if (!didAnything && containerItems.length === 0) {
                role.containerCooldowns.set(target.position.toString(), Date.now());
            } else if (didAnything) {
                role.rememberPOI('farm_chest', target.position);
            }
        }
    }

    private async findChest(bot: Bot, role: FarmingRole) {
        const poi = role.getNearestPOI(bot, 'farm_chest');
        if (poi) {
            const block = bot.blockAt(poi.position);
            if (block && ['chest', 'barrel'].includes(block.name)) return block;
        }
        return bot.findBlock({
            matching: (b) => ['chest', 'barrel'].includes(b.name) && !role.failedBlocks.has(b.position.toString()),
            maxDistance: 32
        });
    }
}