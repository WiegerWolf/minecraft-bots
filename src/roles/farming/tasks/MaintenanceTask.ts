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
        const logs = this.count(inventory, i => i.name.includes('_log') || i.name === 'log' || i.name === 'log2');

        // Logic: If we have no hoe, we need wood.
        if (!hasHoe) {
            // Case A: Gather wood (No planks, no logs)
            if (planks < 2 && logs === 0) {
                const tree = bot.findBlock({
                    matching: (b) => {
                        // STRICT CHECK: Ensure block and position exist before accessing them
                        if (!b || !b.position) return false;
                        
                        // Check name first
                        const name = b.name;
                        const isLog = name.includes('_log') || name === 'log' || name === 'log2';
                        if (!isLog) return false;

                        // Check blacklist using the standardized key
                        const key = b.position.floored().toString();
                        if (role.failedBlocks.has(key)) return false;
                        
                        return true; 
                    },
                    maxDistance: 64
                });
                
                if (tree) {
                    return {
                        priority: 50, // High priority: We are stuck without tools
                        description: `Gathering wood from ${tree.name} at ${tree.position.floored()}`,
                        target: tree,
                        range: 3.0, // Standard reach
                        task: this
                    };
                }
            }
            
            // Case B: Craft Hoe
            if (logs > 0 || planks >= 2) {
                return {
                    priority: 55, // Higher than gathering
                    description: 'Crafting Hoe',
                    task: this
                };
            }
        }

        // 2. Need Chest? (Storage logic)
        // If inventory is nearly full and we have no nearby chest
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
                            if (!b || !b.position) return false; // STRICT CHECK
                            if (b.name === 'farmland' || b.name === 'water') return false;
                            
                            const key = b.position.floored().toString();
                            if (role.failedBlocks.has(key)) return false;

                            const above = bot.blockAt(b.position.offset(0,1,0));
                            return !!(above && above.name === 'air');
                        }
                    });

                    if (spot) {
                        return {
                            priority: 95, // Very high, inventory is full
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
        // Case: Gathering Wood (Target is a block)
        if (target && (target.name.includes('log') || target.name === 'log' || target.name === 'log2')) {
            role.log(`Digging ${target.name}...`);
            await bot.lookAt(target.position.offset(0.5, 0.5, 0.5));
            await bot.dig(target);
            
            // Wait briefly for item pickup before finishing
            const dropPos = target.position;
            await bot.pathfinder.setGoal(new GoalNear(dropPos.x, dropPos.y, dropPos.z, 0.5));
            await new Promise(r => setTimeout(r, 250)); 
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

        // Case: Crafting (No target passed, just logic)
        // 1. Convert logs to planks if needed
        if (this.count(bot.inventory.items(), i => i.name.endsWith('_planks')) < 2) {
             const logItem = bot.inventory.items().find(i => i.name.includes('_log') || i.name === 'log' || i.name === 'log2');
             if (logItem) {
                 let plankName = 'oak_planks';
                 const name = logItem.name;
                 // Map logs to planks
                 if (name.includes('spruce')) plankName = 'spruce_planks';
                 else if (name.includes('birch')) plankName = 'birch_planks';
                 else if (name.includes('jungle')) plankName = 'jungle_planks';
                 else if (name.includes('acacia')) plankName = 'acacia_planks';
                 else if (name.includes('dark_oak')) plankName = 'dark_oak_planks';
                 else if (name.includes('mangrove')) plankName = 'mangrove_planks';
                 else if (name.includes('cherry')) plankName = 'cherry_planks';
                 else if (name.includes('crimson')) plankName = 'crimson_planks';
                 else if (name.includes('warped')) plankName = 'warped_planks';

                 await role.tryCraft(bot, plankName);
             }
        }
        
        // 2. Craft sticks if needed
        if (this.count(bot.inventory.items(), i => i.name === 'stick') < 2) {
            await role.tryCraft(bot, 'stick');
        }

        // 3. Craft the hoe
        await role.tryCraft(bot, 'wooden_hoe');
    }

    private count(items: any[], predicate: (i: any) => boolean): number {
        return items.filter(predicate).reduce((acc, item) => acc + item.count, 0);
    }
}