import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
const { GoalNear } = goals;

export class MaintenanceTask implements Task {
    name = 'maintenance';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        
        const hasHoe = inventory.some(i => i.name.includes('hoe'));
        const planks = this.count(inventory, i => i.name.endsWith('_planks'));
        const logs = this.count(inventory, i => i.name.includes('_log'));

        if (!hasHoe) {
            // Case A: Gather wood
            if (planks < 2 && logs === 0) {
                // Only log if we are truly empty so we don't spam
                if (bot.inventory.emptySlotCount() > 30) {
                    role.log(`[Maintenance] Need wood. Logs: ${logs}, Planks: ${planks}. Searching...`);
                }

                const tree = bot.findBlock({
                    matching: (b) => {
                        if (!b || !b.position) return false;
                        if (role.failedBlocks.has(b.position.toString())) return false;
                        
                        // Broaden matching to catch everything
                        return b.name.includes('_log') || b.name === 'log' || b.name === 'log2'; 
                    },
                    maxDistance: 64
                });
                
                if (tree) {
                    // role.log(`[Maintenance] Found tree: ${tree.name} at ${tree.position}`);
                    return {
                        priority: 50,
                        description: `Gathering wood from ${tree.name} at ${tree.position.floored()}`,
                        target: tree,
                        range: 2.5,
                        task: this
                    };
                } else {
                    if (bot.inventory.emptySlotCount() > 30) {
                        role.log(`[Maintenance] ❌ No trees found via findBlock.`);
                    }
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
                            if (!b || !b.position) return false;
                            if (b.name === 'farmland' || b.name === 'water') return false;
                            if (role.failedBlocks.has(b.position.toString())) return false;

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
        if (target && (target.name.includes('log') || target.name === 'log' || target.name === 'log2')) {
            if (target.position) {
                await bot.lookAt(target.position.offset(0.5, 0.5, 0.5));
            }
            await bot.dig(target);
            
            // Pickup logic
            const dropPos = target.position;
            await new Promise(r => setTimeout(r, 200));
            await bot.pathfinder.setGoal(new GoalNear(dropPos.x, dropPos.y, dropPos.z, 0.5));
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
             const logItem = bot.inventory.items().find(i => i.name.includes('_log') || i.name === 'log' || i.name === 'log2');
             if (logItem) {
                 let plankName = 'oak_planks';
                 const name = logItem.name;
                 if (name.includes('spruce')) plankName = 'spruce_planks';
                 else if (name.includes('birch')) plankName = 'birch_planks';
                 else if (name.includes('jungle')) plankName = 'jungle_planks';
                 else if (name.includes('acacia')) plankName = 'acacia_planks';
                 else if (name.includes('dark_oak')) plankName = 'dark_oak_planks';
                 else if (name.includes('mangrove')) plankName = 'mangrove_planks';
                 else if (name.includes('cherry')) plankName = 'cherry_planks';

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