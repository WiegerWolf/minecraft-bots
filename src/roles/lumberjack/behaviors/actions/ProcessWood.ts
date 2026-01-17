import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ProcessWood - Craft planks and sticks from excess logs
 */
export class ProcessWood implements BehaviorNode {
    name = 'ProcessWood';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Only process if we have logs to process
        if (bb.logCount < 2) return 'failure';

        bb.lastAction = 'process_wood';

        // Calculate how many planks we need for a chest
        const planksNeeded = Math.max(0, 8 - bb.plankCount);
        const logsNeeded = Math.ceil(planksNeeded / 4);

        // Process enough logs to get 8 planks if needed
        let planksCreated = 0;
        if (planksNeeded > 0) {
            for (let i = 0; i < logsNeeded && bb.logCount > 0; i++) {
                const crafted = await this.craftPlanks(bot);
                if (crafted) {
                    planksCreated += 4;
                    bb.logCount--;
                    bb.plankCount += 4;
                } else {
                    break;
                }
            }
        } else {
            // If we have enough planks, process half the remaining logs
            const logsToProcess = Math.floor(bb.logCount / 2);
            for (let i = 0; i < logsToProcess; i++) {
                const crafted = await this.craftPlanks(bot);
                if (crafted) {
                    planksCreated += 4;
                    bb.logCount--;
                    bb.plankCount += 4;
                } else {
                    break;
                }
            }
        }

        if (planksCreated > 0) {
            bb.log?.debug(`[Lumberjack] Processed logs into ${planksCreated} planks`);
        }

        // If we have excess planks, make some sticks
        const currentPlanks = bot.inventory.items()
            .filter(i => i.name.endsWith('_planks'))
            .reduce((s, i) => s + i.count, 0);

        if (currentPlanks >= 16 && bb.stickCount < 32) {
            const sticksToMake = Math.min(4, Math.floor(currentPlanks / 4)); // Make 4 batches max
            let sticksCreated = 0;

            for (let i = 0; i < sticksToMake; i++) {
                const crafted = await this.craftSticks(bot);
                if (crafted) {
                    sticksCreated += 4;
                } else {
                    break;
                }
            }

            if (sticksCreated > 0) {
                bb.log?.debug(`[Lumberjack] Crafted ${sticksCreated} sticks`);
            }
        }

        return planksCreated > 0 ? 'success' : 'failure';
    }

    private async craftPlanks(bot: Bot): Promise<boolean> {
        try {
            const logItem = bot.inventory.items().find(i => i.name.includes('_log'));
            if (!logItem) return false;

            const plankName = logItem.name.replace('_log', '_planks');
            const plankId = bot.registry.itemsByName[plankName]?.id;
            if (!plankId) return false;

            const recipe = bot.recipesFor(plankId, null, 1, null)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1);
            await sleep(100);
            return true;
        } catch (error) {
            return false;
        }
    }

    private async craftSticks(bot: Bot): Promise<boolean> {
        try {
            const stickId = bot.registry.itemsByName['stick']?.id;
            if (!stickId) return false;

            const recipe = bot.recipesFor(stickId, null, 1, null)[0];
            if (!recipe) return false;

            await bot.craft(recipe, 1);
            await sleep(100);
            return true;
        } catch (error) {
            return false;
        }
    }
}
