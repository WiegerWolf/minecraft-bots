import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class MaintenanceTask implements Task {
    name = 'maintenance';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventory = bot.inventory.items();
        const hasHoe = inventory.some(i => i.name.includes('hoe'));
        const planks = this.count(inventory, i => i.name.endsWith('_planks'));
        const logs = this.count(inventory, i => i.name.includes('_log') || i.name === 'log');

        // 1. Gather Wood if we need it
        if (!hasHoe && planks < 8 && logs === 0) {
            const targetLogs = ['log', 'log2', 'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
            
            // USE RESOURCE MIXIN
            // We search for logs, but we need to filter out high ones manually here 
            // because findNaturalBlock returns closest 3D distance, which might be a high branch.
            const logBlock = role.findNaturalBlock(bot, targetLogs, { maxDistance: 64 });

            if (logBlock) {
                // Sanity check: Is it way above us?
                if (logBlock.position.y > bot.entity.position.y + 4) {
                    role.blacklistBlock(logBlock.position); // Ignore high logs for now
                    return null;
                }

                return {
                    priority: 50,
                    description: `Gathering wood at ${logBlock.position.floored()}`,
                    target: logBlock,
                    task: this
                };
            }
        }
        
        // 2. Crafting Checks
        if (logs > 0) return { priority: 55, description: 'Converting logs to planks', task: this };
        const sticks = this.count(inventory, i => i.name === 'stick');
        if (planks >= 2 && sticks < 2) return { priority: 55, description: 'Crafting sticks', task: this };
        if (planks >= 2 && sticks >= 2 && !hasHoe) return { priority: 60, description: 'Crafting Hoe', task: this };

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target?: any): Promise<void> {
        // Case: Wood Gathering
        if (target && target.name && (target.name.includes('log') || target.name.endsWith('_log'))) {
            try {
                // FIX: Use GoalNear to get close to the tree base, range 2.5
                await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2.5));
                
                // Stop to stabilize
                bot.pathfinder.stop();
                bot.pathfinder.setGoal(null);

                const axe = bot.inventory.items().find(i => i.name.includes('_axe'));
                if (axe) await bot.equip(axe, 'hand');

                // Look at center
                await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);

                if (bot.canDigBlock(target)) {
                    await bot.dig(target);
                    await bot.waitForTicks(10); 
                } else {
                    role.log("Cannot reach log.");
                    role.blacklistBlock(target.position);
                }
            } catch (err: any) {
                role.log(`❌ Failed to cut tree: ${err.message}`);
                if (target.position) role.blacklistBlock(target.position);
            }
            return;
        }

        // Case: Crafting (unchanged)
        const inventory = bot.inventory.items();
        if (this.count(inventory, i => i.name.includes('_log')) > 0) {
             await this.craftPlanksFromLogs(bot, role);
             return;
        }
        if (this.count(inventory, i => i.name === 'stick') < 2) {
            await role.tryCraft(bot, 'stick');
            return;
        }
        await role.tryCraft(bot, 'wooden_hoe');
    }

    private async craftPlanksFromLogs(bot: Bot, role: FarmingRole) {
        const logs = bot.inventory.items().filter(i => i.name.includes('_log') || i.name === 'log');
        for (const log of logs) {
            const potentialPlankNames = [log.name.replace(/_?log2?$/, '_planks'), 'oak_planks'];
            let success = false;
            for (const plankName of potentialPlankNames) {
                const plankItem = bot.registry.itemsByName[plankName];
                if (!plankItem) continue;
                const recipes = bot.recipesFor(plankItem.id, null, 1, null);
                const matchingRecipe = recipes.find(r => r.delta.some(d => d.id === log.type && d.count < 0));
                
                if (matchingRecipe) {
                    try {
                        role.log(`Crafting ${plankName} from ${log.name}...`);
                        await bot.craft(matchingRecipe, 1, undefined);
                        success = true;
                        break; 
                    } catch (err) {
                        role.log(`Failed to craft ${plankName}: ${err}`);
                    }
                }
            }
            if (success) return; 
        }
    }

    private count(items: any[], predicate: (i: any) => boolean): number {
        return items.filter(predicate).reduce((acc, item) => acc + item.count, 0);
    }
}