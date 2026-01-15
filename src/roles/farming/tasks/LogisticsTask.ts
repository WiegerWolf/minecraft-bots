// ./src/roles/farming/tasks/LogisticsTask.ts
import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';

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
        const hasHoe = inventory.some(i => i.name.includes('hoe'));

        // Conditions to trigger Logistics
        const isFull = emptySlots < 3;
        // If we have produce but no seeds, we should deposit produce and try to get seeds
        const shouldDeposit = isFull || (hasProduce && !hasSeeds);

        // 1. Deposit / Restock from Chests
        if (shouldDeposit || !hasSeeds) {
            const chest = await this.findChest(bot, role);
            
            // Desperation retry - if no seeds and no chests, clear cooldowns
            if (!chest && !hasSeeds && role.containerCooldowns.size > 0) {
                role.containerCooldowns.clear(); // Will find it next tick
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
        
        // 2. Scavenge Grass for Seeds (CRITICAL FIX)
        if (!hasSeeds) {
            // Priority boost: If we have a hoe but no seeds, this is the most important task
            const priority = hasHoe ? 60 : 20;

            const grass = bot.findBlock({
                matching: b => {
                    if (!b || !b.position) return false;
                    if (role.failedBlocks.has(b.position.toString())) return false;
                    
                    const n = b.name;
                    // Explicit list of breakable plants that drop seeds
                    const targetPlants = [
                        'grass', 'short_grass', 'tall_grass', 
                        'fern', 'large_fern', 'wheat', 'dead_bush'
                    ];
                    
                    // Exclude specific blocks that contain "grass" but aren't plants
                    if (n === 'grass_block' || n === 'seagrass') return false;

                    return targetPlants.includes(n) || n.includes('grass') || n.includes('fern');
                },
                maxDistance: 48 // Check a wide area
            });
            
            if (grass) {
                return {
                    priority: priority,
                    description: `Gathering seeds from ${grass.name} at ${grass.position.floored()}`,
                    target: grass,
                    range: 3.0,
                    task: this
                };
            } else {
                 if (Math.random() < 0.05) role.log(`⚠️ Need seeds, but no grass found nearby.`);
            }
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;

        // Case: Breaking Grass
        if (target.name.includes('grass') || target.name.includes('fern') || target.name === 'dead_bush') {
             try {
                await bot.dig(target);
                // Wait specifically for the "PickupTask" to notice the dropped item
                await new Promise(r => setTimeout(r, 500)); 
             } catch (err) {
                 role.log(`Failed to break grass: ${err}`);
                 role.blacklistBlock(target.position);
             }
             return;
        }

        // Case: Container Interaction
        if (target.name.includes('chest') || target.name.includes('barrel') || target.name.includes('shulker')) {
            const container = await bot.openContainer(target);
            role.log(`Opened ${target.name}.`);

            const inventory = bot.inventory.items();
            const containerItems = container.items();

            let didAnything = false;

            // Deposit Logic
            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin', 'poisonous_potato'];
            
            for (const item of inventory) {
                const isCrop = crops.includes(item.name);
                const isSeed = item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name);

                if (isCrop || isSeed) {
                    if (isSeed) {
                        const totalSeeds = inventory.filter(i => i.name === item.name).reduce((a, b) => a + b.count, 0);
                        if (totalSeeds > this.MAX_SEEDS_TO_KEEP) {
                             const toDeposit = Math.max(0, item.count - this.MAX_SEEDS_TO_KEEP); 
                             await container.deposit(item.type, null, item.count);
                             didAnything = true;
                        }
                    } else {
                        await container.deposit(item.type, null, item.count);
                        didAnything = true;
                    }
                }
            }

            // Withdraw Logic (Restock Seeds)
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

            if (!didAnything && containerItems.length === 0) {
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
                
                const key = b.position.toString();
                if (role.containerCooldowns.has(key)) {
                    const ts = role.containerCooldowns.get(key)!;
                    if (Date.now() - ts < this.CONTAINER_COOLDOWN) return false;
                }
                if (role.failedBlocks.has(key)) return false;

                return true;
            },
            maxDistance: 32
        });
    }
}