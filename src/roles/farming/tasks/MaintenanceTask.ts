import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { Vec3 } from 'vec3';

export class MaintenanceTask implements Task {
    name = 'maintenance';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        
        // 1. NEED HOE?
        const hasHoe = inventory.some(i => i.name.includes('hoe'));
        if (!hasHoe) {
            const planks = this.count(inventory, i => i.name.endsWith('_planks'));
            const logs = this.count(inventory, i => i.name.includes('_log'));

            // Case A: Gather wood
            if (planks < 2 && logs === 0) {
                const tree = bot.findBlock({
                    matching: b => !!b && b.name.includes('_log'),
                    maxDistance: 32
                });
                if (tree) {
                    return {
                        priority: 50,
                        description: 'Gathering wood for tools',
                        target: tree,
                        task: this
                    };
                }
            }
            
            // Case B: Craft
            if (logs > 0 || (planks >= 2)) {
                return {
                    priority: 50,
                    description: 'Crafting Hoe',
                    task: this
                };
            }
        }

        // 2. NEED CHEST?
        if (bot.inventory.emptySlotCount() < 3) {
            const nearbyChest = role.getNearestPOI(bot, 'farm_chest');
            if (!nearbyChest) {
                const hasChestItem = inventory.some(i => i.name === 'chest');
                
                if (hasChestItem) {
                    const anchor = role.getNearestPOI(bot, 'farm_center');
                    const center = anchor ? anchor.position : bot.entity.position;
                    
                    const spot = bot.findBlock({
                        point: center,
                        maxDistance: 5,
                        matching: (b) => {
                            if (!b || !b.position) return false; // FIX: Robust Null check
                            if (b.name === 'farmland' || b.name === 'water') return false;
                            const above = bot.blockAt(b.position.offset(0,1,0));
                            return !!(above && above.name === 'air');
                        }
                    });

                    if (spot) {
                        return {
                            priority: 95,
                            description: 'Placing new storage chest',
                            target: spot,
                            task: this
                        };
                    }
                }
            }
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target?: any): Promise<void> {
        // Case: Gathering Wood
        if (target && target.name && target.name.includes('_log')) {
            await bot.dig(target);
            return;
        }

        // Case: Placing Chest
        if (target && this.count(bot.inventory.items(), i => i.name === 'chest') > 0) {
            const chest = bot.inventory.items().find(i => i.name === 'chest');
            if (chest) {
                await bot.equip(chest, 'hand');
                await bot.placeBlock(target, new Vec3(0, 1, 0));
                role.rememberPOI('farm_chest', target.position.offset(0,1,0));
                return;
            }
        }

        // Case: Crafting (No target passed)
        if (this.count(bot.inventory.items(), i => i.name.endsWith('_planks')) < 2) {
             const logItem = bot.inventory.items().find(i => i.name.includes('_log'));
             if (logItem) {
                 const plankName = logItem.name.replace('_log', '_planks');
                 await role.tryCraft(bot, plankName);
             }
        }
        
        if (this.count(bot.inventory.items(), i => i.name === 'stick') < 2) {
            await role.tryCraft(bot, 'stick');
        }

        await role.tryCraft(bot, 'wooden_hoe');
    }

    private count(items: any[], predicate: (i: any) => boolean): number {
        return items.filter(predicate).reduce((acc, item) => acc + item.count, 0);
    }
}