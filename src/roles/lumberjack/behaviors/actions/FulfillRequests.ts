import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { villageManager } from '../../../../shared/VillageState';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear, GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * FulfillRequests - Check for pending requests from other bots and fulfill them
 */
export class FulfillRequests implements BehaviorNode {
    name = 'FulfillRequests';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Get pending requests this bot can fulfill
        let requests;
        try {
            requests = await villageManager.getPendingRequests('lumberjack');
        } catch (error) {
            console.warn('[Lumberjack] Failed to get requests:', error);
            return 'failure';
        }

        if (requests.length === 0) return 'failure';

        const request = requests[0]!; // Oldest first
        console.log(`[Lumberjack] Processing request: ${request.from} needs ${request.quantity}x ${request.item}`);

        // Map requested item to what we can provide
        const itemNeeded = this.normalizeItemName(request.item);
        const hasItem = this.countItem(bot, itemNeeded) >= request.quantity;

        if (!hasItem) {
            // Try to craft it
            const crafted = await this.craftItem(bot, bb, itemNeeded, request.quantity);
            if (!crafted) {
                console.log(`[Lumberjack] Cannot fulfill request for ${request.item} - need more materials`);
                return 'failure';
            }
        }

        // Find shared chest to deposit
        if (!bb.sharedChest) {
            console.log(`[Lumberjack] No shared chest available for deposit`);
            return 'failure';
        }

        // Go to shared chest and deposit
        bb.lastAction = 'fulfill_request';
        try {
            const chest = bot.blockAt(bb.sharedChest);
            if (!chest) {
                console.log(`[Lumberjack] Cannot find shared chest at ${bb.sharedChest}`);
                return 'failure';
            }

            await bot.pathfinder.goto(new GoalLookAtBlock(chest.position, bot.world, { reach: 4 }));

            const chestWindow = await bot.openContainer(chest);
            await sleep(100);

            // Deposit the requested items
            const items = bot.inventory.items().filter(i => i.name.includes(itemNeeded) || itemNeeded.includes(i.name));
            let deposited = 0;
            for (const item of items) {
                if (deposited >= request.quantity) break;
                const toDeposit = Math.min(item.count, request.quantity - deposited);
                try {
                    await chestWindow.deposit(item.type, null, toDeposit);
                    deposited += toDeposit;
                } catch (err) {
                    console.log(`[Lumberjack] Failed to deposit ${item.name}: ${err}`);
                }
            }

            chestWindow.close();

            if (deposited >= request.quantity) {
                await villageManager.fulfillRequest(request.id);
                console.log(`[Lumberjack] Fulfilled request: ${request.quantity}x ${request.item} for ${request.from}`);
                return 'success';
            } else {
                console.log(`[Lumberjack] Only deposited ${deposited}/${request.quantity} ${request.item}`);
                return 'running';
            }
        } catch (error) {
            console.warn(`[Lumberjack] Error fulfilling request:`, error);
            return 'failure';
        }
    }

    private normalizeItemName(item: string): string {
        // Normalize common item names
        if (item.includes('stick')) return 'stick';
        if (item.includes('planks') || item.includes('plank')) return 'planks';
        if (item.includes('log')) return 'log';
        return item;
    }

    private countItem(bot: Bot, itemName: string): number {
        return bot.inventory.items()
            .filter(i => i.name.includes(itemName) || itemName.includes(i.name))
            .reduce((sum, i) => sum + i.count, 0);
    }

    private async craftItem(bot: Bot, bb: LumberjackBlackboard, item: string, quantity: number): Promise<boolean> {
        if (item === 'stick') {
            // Need planks to make sticks
            // 2 planks = 4 sticks
            const planksNeeded = Math.ceil(quantity / 2);
            if (bb.plankCount < planksNeeded) {
                // Try to make planks first
                const logsNeeded = Math.ceil(planksNeeded / 4);
                if (bb.logCount < logsNeeded) {
                    return false; // Not enough logs
                }
                // Craft planks
                const crafted = await this.craftPlanks(bot, logsNeeded);
                if (!crafted) return false;
            }
            // Now craft sticks
            return this.craftSticks(bot, quantity);
        }

        if (item === 'planks') {
            const logsNeeded = Math.ceil(quantity / 4);
            if (bb.logCount < logsNeeded) return false;
            return this.craftPlanks(bot, logsNeeded);
        }

        return false;
    }

    private async craftPlanks(bot: Bot, logsNeeded: number): Promise<boolean> {
        try {
            const logItem = bot.inventory.items().find(i => i.name.includes('_log'));
            if (!logItem) return false;

            const plankName = logItem.name.replace('_log', '_planks');
            const recipe = bot.recipesFor(bot.registry.itemsByName[plankName]?.id ?? 0, null, 1, null)[0];
            if (!recipe) {
                console.log(`[Lumberjack] No recipe found for ${plankName}`);
                return false;
            }

            const craftCount = Math.min(logsNeeded, Math.floor(logItem.count));
            for (let i = 0; i < craftCount; i++) {
                await bot.craft(recipe, 1);
                await sleep(100);
            }
            console.log(`[Lumberjack] Crafted ${craftCount * 4} planks`);
            return true;
        } catch (error) {
            console.warn(`[Lumberjack] Failed to craft planks:`, error);
            return false;
        }
    }

    private async craftSticks(bot: Bot, quantity: number): Promise<boolean> {
        try {
            const stickId = bot.registry.itemsByName['stick']?.id;
            if (!stickId) return false;

            const recipe = bot.recipesFor(stickId, null, 1, null)[0];
            if (!recipe) {
                console.log(`[Lumberjack] No recipe found for sticks`);
                return false;
            }

            // Each craft gives 4 sticks, needs 2 planks
            const craftCount = Math.ceil(quantity / 4);
            for (let i = 0; i < craftCount; i++) {
                await bot.craft(recipe, 1);
                await sleep(100);
            }
            console.log(`[Lumberjack] Crafted ${craftCount * 4} sticks`);
            return true;
        } catch (error) {
            console.warn(`[Lumberjack] Failed to craft sticks:`, error);
            return false;
        }
    }
}
