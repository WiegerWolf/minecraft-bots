import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

export class LogisticsTask implements Task {
    name = 'logistics';
    private readonly MAX_SEEDS_TO_KEEP = 64;
    private readonly CONTAINER_COOLDOWN = 60000; // 1 minute cooldown on empty chests

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const emptySlots = bot.inventory.emptySlotCount();
        
        // Determine Inventory State
        const hasSeeds = inventory.some(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        const hasProduce = inventory.some(item => 
            ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'].includes(item.name)
        );

        // Conditions to trigger Logistics
        const isFull = emptySlots < 3;
        const needsSeeds = !hasSeeds;
        
        // LESSON: If we have produce but no seeds, we should deposit produce and try to get seeds
        const shouldDeposit = isFull || (hasProduce && !hasSeeds);

        if (shouldDeposit || needsSeeds) {
            const chest = await this.findChest(bot, role);
            
            // LESSON: Desperation retry - if no seeds and no chests, clear cooldowns
            if (!chest && needsSeeds && role.containerCooldowns.size > 0) {
                role.log("No chests found but need seeds. Clearing cooldowns.");
                role.containerCooldowns.clear();
                return null; // Will find it next tick
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
        
        if (!hasSeeds) {
            const chest = await this.findChest(bot, role);
            if (chest) {
                return {
                    priority: 50,
                    description: 'Checking chest for seeds',
                    target: chest,
                    range: 2.5,
                    task: this
                };
            }
            
            // Scavenge grass
            const grass = bot.findBlock({
                matching: b => {
                    if (!b || !b.position) return false;
                    if (role.failedBlocks.has(b.position.toString())) return false;
                    
                    const name = b.name;
                    const isPlant = (name.includes('grass') || name.includes('fern')) && 
                                    !name.includes('grass_block') && 
                                    !name.includes('seagrass');
                                    
                    return isPlant || name === 'dead_bush' || name === 'wheat'; 
                },
                maxDistance: 64
            });
            
            if (grass) {
                return {
                    priority: 20,
                    description: `Gathering seeds from ${grass.name} at ${grass.position.floored()}`,
                    target: grass,
                    range: 3.0,
                    task: this
                };
            } else {
                 if (bot.inventory.emptySlotCount() > 30) {
                     // role.log(`[Logistics] ❌ No grass/ferns found via findBlock.`);
                 }
            }
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;

        // Container Interaction
        if (target.name.includes('chest') || target.name.includes('barrel') || target.name.includes('shulker')) {
            const container = await bot.openContainer(target);
            role.log(`Opened ${target.name}.`);

            const inventory = bot.inventory.items();
            const containerItems = container.items();

            let didAnything = false;

            // 1. Deposit Logic
            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin', 'poisonous_potato'];
            
            for (const item of inventory) {
                const isCrop = crops.includes(item.name);
                const isSeed = item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name);

                if (isCrop || isSeed) {
                    if (isSeed) {
                        // LESSON: Keep a stack of seeds
                        const totalSeeds = inventory.filter(i => i.name === item.name).reduce((a, b) => a + b.count, 0);
                        if (totalSeeds > this.MAX_SEEDS_TO_KEEP) {
                             const toDeposit = Math.max(0, item.count - this.MAX_SEEDS_TO_KEEP); // Simple logic
                             // Better: Deposit all, then withdraw what we need
                             await container.deposit(item.type, null, item.count);
                             didAnything = true;
                        }
                    } else {
                        // Deposit all produce
                        await container.deposit(item.type, null, item.count);
                        didAnything = true;
                    }
                }
            }

            // 2. Withdraw Logic (Restock Seeds)
            const seedNames = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
            for (const name of seedNames) {
                const currentCount = bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                if (currentCount < this.MAX_SEEDS_TO_KEEP) {
                    const chestItem = containerItems.find(i => i.name === name);
                    if (chestItem) {
                        const needed = this.MAX_SEEDS_TO_KEEP - currentCount;
                        const toWithdraw = Math.min(needed, chestItem.count);
                        await container.withdraw(chestItem.type, null, toWithdraw);
                        role.log(`Withdrew ${toWithdraw} ${name}.`);
                        didAnything = true;
                    }
                }
            }

            container.close();

            // LESSON: If the chest was empty/useless, cooldown it
            if (!didAnything && containerItems.length === 0) {
                role.log(`Container empty. Ignoring for ${this.CONTAINER_COOLDOWN/1000}s.`);
                role.containerCooldowns.set(target.position.toString(), Date.now());
            } else if (didAnything) {
                role.rememberPOI('farm_chest', target.position);
            }
        }
    }

    private async findChest(bot: Bot, role: FarmingRole) {
        // Check POI first
        const poi = role.getNearestPOI(bot, 'farm_chest');
        if (poi) {
            const block = bot.blockAt(poi.position);
            if (block && ['chest', 'barrel'].includes(block.name)) {
                return block;
            }
        }

        return bot.findBlock({
            matching: (b) => {
                if (!['chest', 'barrel', 'trapped_chest'].includes(b.name)) return false;
                
                // Check Cooldowns
                const key = b.position.toString();
                if (role.containerCooldowns.has(key)) {
                    const ts = role.containerCooldowns.get(key)!;
                    if (Date.now() - ts < this.CONTAINER_COOLDOWN) return false;
                }
                
                // Check Hard Failures
                if (role.failedBlocks.has(key)) return false;

                return true;
            },
            maxDistance: 32
        });
    }
}