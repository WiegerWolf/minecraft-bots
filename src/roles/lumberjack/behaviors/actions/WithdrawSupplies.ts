import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

/**
 * WithdrawSupplies - Check chest for useful supplies on spawn
 *
 * Smart item selection:
 * 1. Take any axe (if we don't have one)
 * 2. Take some logs (up to 16, if low)
 * 3. Take some planks (up to 16, if low)
 * 4. Take some sticks (up to 16, if low)
 *
 * Respects sharing - doesn't take everything, leaves some for others.
 */
export class WithdrawSupplies implements BehaviorNode {
    name = 'WithdrawSupplies';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Already checked or no storage
        if (bb.hasCheckedStorage) {
            return 'success';
        }

        // Find chest position - ONLY use known chests
        // Use shared chest OR chests from sign knowledge (knownChests)
        // Never adopt random nearby chests - they could be pregenerated
        // dungeon/mineshaft chests that are unreachable or underground
        const chestPos = bb.sharedChest || bb.knownChests[0];
        if (!chestPos) {
            bb.log?.debug('No known chest available to check for supplies');
            bb.hasCheckedStorage = true;
            return 'success';
        }

        bb.lastAction = 'withdraw_supplies';
        bb.log?.info({ chestPos: chestPos.toString() }, 'Checking chest for startup supplies');

        // Walk to chest
        try {
            const chestGoal = new GoalNear(chestPos.x, chestPos.y, chestPos.z, 3);
            const reached = await pathfinderGotoWithRetry(bot, chestGoal, 2, 10000);
            if (!reached) {
                bb.log?.warn('Could not reach chest');
                bb.hasCheckedStorage = true;
                return 'failure';
            }
        } catch (err) {
            bb.log?.warn({ err }, 'Error walking to chest');
            bb.hasCheckedStorage = true;
            return 'failure';
        }

        // Open chest
        const chestBlock = bot.blockAt(chestPos);
        if (!chestBlock || !['chest', 'barrel'].includes(chestBlock.name)) {
            bb.log?.warn('Chest block not found at expected position');
            bb.hasCheckedStorage = true;
            return 'failure';
        }

        let chest: any;
        try {
            chest = await bot.openContainer(chestBlock);
            await sleep(200);
        } catch (err) {
            bb.log?.warn({ err }, 'Could not open chest');
            bb.hasCheckedStorage = true;
            return 'failure';
        }

        const withdrawn: string[] = [];

        try {
            // Check what we need
            const hasAxe = bot.inventory.items().some(i => i.name.includes('axe'));
            const logCount = bot.inventory.items()
                .filter(i => i.name.includes('_log'))
                .reduce((s, i) => s + i.count, 0);
            const plankCount = bot.inventory.items()
                .filter(i => i.name.endsWith('_planks'))
                .reduce((s, i) => s + i.count, 0);
            const stickCount = bot.inventory.items()
                .filter(i => i.name === 'stick')
                .reduce((s, i) => s + i.count, 0);

            // Look through chest items
            const chestItems = chest.containerItems();

            // 1. Take an axe if we don't have one
            if (!hasAxe) {
                const axeItem = chestItems.find((i: any) => i.name.includes('axe'));
                if (axeItem) {
                    await chest.withdraw(axeItem.type, null, 1);
                    withdrawn.push(axeItem.name);
                    bb.log?.info({ item: axeItem.name }, 'Withdrew axe from chest');
                    await sleep(100);
                }
            }

            // 2. Take logs if we have few (up to 16, leave at least 8 in chest)
            if (logCount < 8) {
                const logItem = chestItems.find((i: any) => i.name.includes('_log') && i.count > 8);
                if (logItem) {
                    const toTake = Math.min(16 - logCount, logItem.count - 8);
                    if (toTake > 0) {
                        await chest.withdraw(logItem.type, null, toTake);
                        withdrawn.push(`${toTake} ${logItem.name}`);
                        bb.log?.info({ item: logItem.name, count: toTake }, 'Withdrew logs from chest');
                        await sleep(100);
                    }
                }
            }

            // 3. Take planks if we have few (up to 16, leave at least 8 in chest)
            if (plankCount < 8) {
                const plankItem = chestItems.find((i: any) => i.name.endsWith('_planks') && i.count > 8);
                if (plankItem) {
                    const toTake = Math.min(16 - plankCount, plankItem.count - 8);
                    if (toTake > 0) {
                        await chest.withdraw(plankItem.type, null, toTake);
                        withdrawn.push(`${toTake} ${plankItem.name}`);
                        bb.log?.info({ item: plankItem.name, count: toTake }, 'Withdrew planks from chest');
                        await sleep(100);
                    }
                }
            }

            // 4. Take sticks if we have few (up to 16, leave at least 8 in chest)
            if (stickCount < 8) {
                const stickItem = chestItems.find((i: any) => i.name === 'stick' && i.count > 8);
                if (stickItem) {
                    const toTake = Math.min(16 - stickCount, stickItem.count - 8);
                    if (toTake > 0) {
                        await chest.withdraw(stickItem.type, null, toTake);
                        withdrawn.push(`${toTake} sticks`);
                        bb.log?.info({ count: toTake }, 'Withdrew sticks from chest');
                        await sleep(100);
                    }
                }
            }
        } catch (err) {
            bb.log?.warn({ err }, 'Error withdrawing items from chest');
        } finally {
            // Close chest
            try {
                chest.close();
            } catch {
                // Ignore close errors
            }
        }

        // Announce what was taken
        if (withdrawn.length > 0) {
            bot.chat(`Found supplies in chest: ${withdrawn.join(', ')}`);
        } else {
            bot.chat('Checked chest - nothing I need right now');
        }

        bb.log?.info({ withdrawn }, 'Finished checking chest for supplies');
        bb.hasCheckedStorage = true;
        return 'success';
    }
}
