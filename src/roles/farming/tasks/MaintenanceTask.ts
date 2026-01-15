import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock } = goals;

export class MaintenanceTask implements Task {
    name = 'maintenance';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const hasHoe = inventory.some(i => i.name.includes('hoe'));
        const planks = this.count(inventory, i => i.name.endsWith('_planks'));
        const logs = this.count(inventory, i => i.name.includes('_log') || i.name === 'log');

        // 1. Gather Wood if we need it for tools
        if (!hasHoe && planks < 8 && logs === 0) {
            const logBlock = bot.findBlock({
                matching: (b) => {
                    // FIX: Safety Check
                    if (!b || !b.name) return false;
                    return ['log', 'log2'].includes(b.name) || b.name.endsWith('_log');
                },
                maxDistance: 32,
                useExtraInfo: false
            });

            if (logBlock && logBlock.position) {
                if (role.failedBlocks.has(logBlock.position.toString())) return null;

                return {
                    priority: 50,
                    description: `Gathering wood at ${logBlock.position.floored()}`,
                    target: logBlock,
                    task: this
                };
            }
        }
        
        // 2. Crafting Checks
        // If we have logs, convert to planks
        if (logs > 0) {
            return {
                priority: 55,
                description: 'Converting logs to planks',
                task: this
            };
        }

        // If we have planks but no sticks, craft sticks
        const sticks = this.count(inventory, i => i.name === 'stick');
        if (planks >= 2 && sticks < 2) {
            return {
                priority: 55,
                description: 'Crafting sticks',
                task: this
            };
        }

        // If we have materials, craft Hoe
        if (planks >= 2 && sticks >= 2 && !hasHoe) {
             return {
                priority: 60,
                description: 'Crafting Hoe',
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target?: any): Promise<void> {
        // Case: Wood Gathering
        if (target && target.name && (target.name.includes('log') || target.name.endsWith('_log'))) {
            try {
                // Use GoalLookAtBlock so we don't walk inside the tree
                await bot.pathfinder.goto(new GoalLookAtBlock(target.position, bot.world));
                
                // Equip axe if available
                const axe = bot.inventory.items().find(i => i.name.includes('_axe'));
                if (axe) await bot.equip(axe, 'hand');

                await bot.dig(target);
                await bot.waitForTicks(10); // Wait for item pickup
            } catch (err: any) {
                role.log(`❌ Failed to cut tree: ${err.message}`);
                if (target.position) role.blacklistBlock(target.position);
            }
            return;
        }

        // Case: Crafting
        const inventory = bot.inventory.items();
        
        // 1. Logs -> Planks
        if (this.count(inventory, i => i.name.includes('_log')) > 0) {
             await this.craftPlanksFromLogs(bot, role);
             return;
        }

        // 2. Planks -> Sticks
        if (this.count(inventory, i => i.name === 'stick') < 2) {
            await role.tryCraft(bot, 'stick');
            return;
        }

        // 3. Craft Hoe
        await role.tryCraft(bot, 'wooden_hoe');
    }

    private async craftPlanksFromLogs(bot: Bot, role: FarmingRole) {
        // Simple 2x2 crafting for planks (doesn't need table)
        const logs = bot.inventory.items().filter(i => i.name.includes('_log') || i.name === 'log');
        for (const log of logs) {
             // Find the plank recipe for this log type
             const recipes = bot.recipesAll(bot.registry.itemsByName['oak_planks'].id, null, null); 
             // Note: generic logic to find plank result from log input is complex, 
             // simplest way is iterate all plank types or trust tryCraft knows recipe
             
             // Simplification: Just try crafting 'oak_planks' or generic planks if 1.16+
             // A more robust solution uses recipesFor() on the log item ID
             const recipesForLog = bot.recipesAll(null, null, null).filter(r => r.delta.some(d => d.id === log.type && d.count < 0));
             
             if (recipesForLog.length > 0) {
                 await bot.craft(recipesForLog[0], 1, null);
                 return;
             }
        }
    }

    private count(items: any[], predicate: (i: any) => boolean): number {
        return items.filter(predicate).reduce((acc, item) => acc + item.count, 0);
    }
}