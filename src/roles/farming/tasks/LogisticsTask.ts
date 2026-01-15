import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock, GoalNear } = goals;

export class LogisticsTask implements Task {
    name = 'logistics';
    private readonly MAX_SEEDS_TO_KEEP = 64;
    private readonly CONTAINER_COOLDOWN = 60000; 

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const emptySlots = bot.inventory.emptySlotCount();
        
        const hasSeeds = inventory.some(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        const hasProduce = inventory.some(item => 
            ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'].includes(item.name)
        );
        const hasHoe = inventory.some(i => i.name.includes('hoe'));

        const isFull = emptySlots < 3;
        const shouldDeposit = isFull || (hasProduce && !hasSeeds);

        // 1. Deposit / Restock
        if (shouldDeposit || !hasSeeds) {
            const chest = await this.findChest(bot, role);
            if (!chest && !hasSeeds && role.containerCooldowns.size > 0) {
                role.containerCooldowns.clear(); 
            }

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
        if (!hasSeeds) {
            const priority = hasHoe ? 60 : 20;
            const targetPlants = [
                'grass', 'short_grass', 'tall_grass', 
                'fern', 'large_fern', 'wheat', 'dead_bush'
            ];

            const grass = role.findNaturalBlock(bot, targetPlants, { maxDistance: 48 }); // Reduced distance slightly to avoid far pathfinding
            
            if (grass) {
                return {
                    priority: priority,
                    description: `Gathering seeds from ${grass.name} at ${grass.position.floored()}`,
                    target: grass,
                    task: this
                };
            } else {
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

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        // Case: Exploration
        if (!target) {
            await role.wanderNewChunk(bot);
            return;
        }

        // Case: Breaking Grass
        if (target.name.includes('grass') || target.name.includes('fern') || target.name === 'dead_bush') {
             try {
                // FIX: Use GoalNear (Range 1) instead of LookAtBlock. 
                // LookAtBlock can be strict about visibility. GoalNear just gets us close.
                await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 1));
                
                // CRITICAL FIX: Stop pathfinding so it doesn't fight the look control
                bot.pathfinder.stop();
                bot.pathfinder.setGoal(null);

                // CRITICAL FIX: Look at the CENTER of the block instantly
                await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);

                if (bot.canDigBlock(target)) {
                    await bot.dig(target);
                    await new Promise(r => setTimeout(r, 250)); // Wait for drop
                } else {
                    role.log(`Cannot dig block (too far or obstructed).`);
                    role.blacklistBlock(target.position);
                }
             } catch (err) {
                 role.log(`Failed to break grass: ${err}`);
                 role.blacklistBlock(target.position);
             }
             return;
        }

        // Case: Container Interaction
        if (target.name.includes('chest') || target.name.includes('barrel') || target.name.includes('shulker')) {
            try {
                await bot.pathfinder.goto(new GoalLookAtBlock(target.position, bot.world));
            } catch (e) {
                // Ignore path error, try opening anyway
            }

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