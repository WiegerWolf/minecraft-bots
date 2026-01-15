import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';
const { GoalNear } = goals;

export class LogisticsTask implements Task {
    name = 'logistics';
    private readonly MAX_SEEDS_TO_KEEP = 64;

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const isFull = bot.inventory.emptySlotCount() < 3;
        
        const hasSeeds = inventory.some(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );

        if (isFull) {
            const chest = await this.findChest(bot, role);
            if (chest) {
                return {
                    priority: 100,
                    description: 'Depositing items (Inventory Full)',
                    target: chest,
                    range: 2.5,
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
            const grassTypes = ['grass', 'tall_grass', 'short_grass', 'fern', 'dead_bush'];
            const grass = bot.findBlock({
                matching: b => {
                    if (!b || !b.position) return false;
                    if (role.failedBlocks.has(b.position.toString())) return false;
                    return grassTypes.includes(b.name);
                },
                maxDistance: 64
            });
            if (grass) {
                return {
                    priority: 20,
                    description: `Gathering seeds from ${grass.name}`,
                    target: grass,
                    range: 3.0,
                    task: this
                };
            } else {
                 // role.log("🔍 No grass/ferns found nearby to harvest seeds.");
            }
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const blockName = target.name;

        if (['grass', 'tall_grass', 'short_grass', 'fern', 'dead_bush'].includes(blockName)) {
            await bot.lookAt(target.position.offset(0.5, 0.5, 0.5));
            await bot.dig(target);
            
            // Walk to the drop location to pick it up
            const dropPos = target.position;
            await new Promise(r => setTimeout(r, 200));
            await bot.pathfinder.setGoal(new GoalNear(dropPos.x, dropPos.y, dropPos.z, 0.5));
            return;
        }

        if (blockName.includes('chest') || blockName.includes('barrel') || blockName.includes('shulker')) {
            const container = await bot.openContainer(target);
            role.log(`Opened ${blockName}.`);

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
        const known = role.getNearestPOI(bot, 'farm_chest');
        if (known) {
            const block = bot.blockAt(known.position);
            if (block && ['chest', 'barrel', 'trapped_chest'].includes(block.name)) {
                return block;
            } else {
                role.forgetPOI('farm_chest', known.position);
            }
        }

        return bot.findBlock({
            matching: b => !!b && ['chest', 'barrel', 'trapped_chest'].includes(b.name), 
            maxDistance: 32
        });
    }
}