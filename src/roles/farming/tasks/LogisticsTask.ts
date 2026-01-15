import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock, GoalNear } = goals;

export class LogisticsTask implements Task {
    name = 'logistics';
    private readonly MAX_SEEDS_TO_KEEP = 64;
    private readonly MIN_SEEDS_TO_START_FARMING = 3; // Hysteresis buffer
    private readonly CONTAINER_COOLDOWN = 60000; 

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const emptySlots = bot.inventory.emptySlotCount();
        
        // Count seeds
        const seedCount = inventory
            .filter(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name))
            .reduce((sum, item) => sum + item.count, 0);

        const hasProduce = inventory.some(item => 
            ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'].includes(item.name)
        );
        const hasHoe = inventory.some(i => i.name.includes('hoe'));

        const isFull = emptySlots < 3;
        const shouldDeposit = isFull || (hasProduce && seedCount === 0);

        // 1. Deposit / Restock Logic (Unchanged)
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
        // Logic: If we have < 3 seeds, prioritize gathering.
        // If we have 0 seeds, priority is Critical (if we have a hoe).
        if (seedCount < this.MIN_SEEDS_TO_START_FARMING) {
            const priority = (seedCount === 0 && hasHoe) ? 60 : 35;

            const targetPlants = [
                'grass', 'short_grass', 'tall_grass', 
                'fern', 'large_fern', 'wheat', 'dead_bush'
            ];

            const grass = role.findNaturalBlock(bot, targetPlants, { maxDistance: 48 });
            
            if (grass) {
                return {
                    priority: priority,
                    description: `Gathering seeds from ${grass.name} (${seedCount}/${this.MIN_SEEDS_TO_START_FARMING})`,
                    target: grass,
                    task: this
                };
            } else if (seedCount === 0) {
                // Only explore if we are completely out of seeds
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

    // perform method remains the same as previous "fixed" version
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
                await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
                if (bot.canDigBlock(target)) {
                    await bot.dig(target);
                    await new Promise(r => setTimeout(r, 250)); 
                } else {
                    role.blacklistBlock(target.position);
                }
             } catch (err) {
                 role.blacklistBlock(target.position);
             }
             return;
        }

        // Chest logic (copy from previous valid response or keep as is)
        if (target.name.includes('chest') || target.name.includes('barrel') || target.name.includes('shulker')) {
            try { await bot.pathfinder.goto(new GoalLookAtBlock(target.position, bot.world)); } catch (e) {}
            const container = await bot.openContainer(target);
            role.log(`Opened ${target.name}.`);

            const inventory = bot.inventory.items();
            const containerItems = container.items();
            let didAnything = false;

            // Deposit logic...
            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin', 'poisonous_potato'];
            for (const item of inventory) {
                const isCrop = crops.includes(item.name);
                const isSeed = item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name);

                if (isCrop || isSeed) {
                    if (isSeed) {
                        const totalSeeds = inventory.filter(i => i.name === item.name).reduce((a, b) => a + b.count, 0);
                        if (totalSeeds > this.MAX_SEEDS_TO_KEEP) {
                             await container.deposit(item.type, null, item.count);
                             didAnything = true;
                        }
                    } else {
                        await container.deposit(item.type, null, item.count);
                        didAnything = true;
                    }
                }
            }

            // Withdraw logic...
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
        }
    }

    private async findChest(bot: Bot, role: FarmingRole) {
         const poi = role.getNearestPOI(bot, 'farm_chest');
        if (poi) {
            const block = bot.blockAt(poi.position);
            if (block && ['chest', 'barrel'].includes(block.name)) return block;
        }
        return bot.findBlock({
            matching: (b) => {
                if (!['chest', 'barrel', 'trapped_chest'].includes(b.name)) return false;
                const key = b.position.toString();
                if (role.containerCooldowns.has(key)) {
                    if (Date.now() - role.containerCooldowns.get(key)! < this.CONTAINER_COOLDOWN) return false;
                }
                if (role.failedBlocks.has(key)) return false;
                return true;
            },
            maxDistance: 32
        });
    }
}