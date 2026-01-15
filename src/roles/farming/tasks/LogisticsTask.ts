import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';

export class LogisticsTask implements Task {
    name = 'logistics';
    private readonly MAX_SEEDS_TO_KEEP = 64;

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const isFull = bot.inventory.emptySlotCount() < 3;
        
        const hasSeeds = inventory.some(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );

        // 1. CRITICAL: Deposit if full
        if (isFull) {
            const chest = await this.findChest(bot, role);
            if (chest) {
                return {
                    priority: 100,
                    description: 'Depositing items (Inventory Full)',
                    target: chest,
                    range: 2.5, // Closer range for chest interaction
                    task: this
                };
            } else {
                role.log("Inventory full but no chest found!");
            }
        }

        // 2. HIGH: Find seeds if we have none (Scavenge or Withdraw)
        if (!hasSeeds) {
            // Check known chests first
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
            
            // If no chest, look for grass to break (Scavenging)
            const grass = bot.findBlock({
                matching: b => {
                    if (!b || !b.position) return false;
                    if (role.failedBlocks.has(b.position.toString())) return false; // Check blacklist
                    return ['grass', 'tall_grass', 'short_grass', 'fern'].includes(b.name);
                },
                maxDistance: 32
            });
            if (grass) {
                return {
                    priority: 20,
                    description: 'Gathering seeds from grass',
                    target: grass,
                    range: 2.5, // Closer range for digging
                    task: this
                };
            }
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const blockName = target.name;

        // Action: Scavenge Grass
        if (blockName.includes('grass') || blockName.includes('fern')) {
            await bot.lookAt(target.position.offset(0.5, 0.5, 0.5));
            await bot.dig(target);
            return;
        }

        // Action: Interact with Chest
        if (blockName.includes('chest') || blockName.includes('barrel') || blockName.includes('shulker')) {
            const container = await bot.openContainer(target);
            role.log(`Opened ${blockName}.`);

            // 1. Deposit Crops
            const items = bot.inventory.items();
            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'];
            
            for (const item of items) {
                if (crops.includes(item.name) || item.name.includes('seeds')) {
                    if (item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)) {
                        const count = item.count;
                        await container.deposit(item.type, null, count);
                    } else {
                        await container.deposit(item.type, null, item.count);
                    }
                }
            }

            // 2. Withdraw Seeds
            const seedNames = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
            for (const name of seedNames) {
                const current = bot.inventory.items().find(i => i.name === name);
                const currentCount = current ? current.count : 0;
                
                if (currentCount < this.MAX_SEEDS_TO_KEEP) {
                    const needed = this.MAX_SEEDS_TO_KEEP - currentCount;
                    const chestItem = container.items().find(i => i.name === name);
                    if (chestItem) {
                        await container.withdraw(chestItem.type, null, Math.min(needed, chestItem.count));
                    }
                }
            }
            
            role.rememberPOI('farm_chest', target.position);
            container.close();
        }
    }

    private async findChest(bot: Bot, role: FarmingRole) {
        // 1. Check memory
        const known = role.getNearestPOI(bot, 'farm_chest');
        if (known) {
            const block = bot.blockAt(known.position);
            if (block && ['chest', 'barrel', 'trapped_chest'].includes(block.name)) {
                return block;
            } else {
                role.forgetPOI('farm_chest', known.position);
            }
        }

        // 2. Scan
        return bot.findBlock({
            matching: b => !!b && ['chest', 'barrel', 'trapped_chest'].includes(b.name), 
            maxDistance: 32
        });
    }
}