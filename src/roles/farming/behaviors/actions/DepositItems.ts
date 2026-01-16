import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalLookAtBlock } = goals;

export class DepositItems implements BehaviorNode {
    name = 'DepositItems';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Deposit if inventory is full OR we have some produce OR lots of seeds
        // Lower threshold (16) to deposit more frequently
        const shouldDeposit = bb.inventoryFull || bb.produceCount >= 16 || bb.seedCount >= 64;
        if (!shouldDeposit) return 'failure';

        // Prefer farm chest, fall back to nearby chests
        let chestPos: Vec3 | null = bb.farmChest;
        if (!chestPos && bb.nearbyChests.length > 0 && bb.nearbyChests[0]) {
            chestPos = bb.nearbyChests[0].position;
        }
        if (!chestPos) return 'failure';

        const chestBlock = bot.blockAt(chestPos);
        if (!chestBlock || chestBlock.name !== 'chest') {
            // Chest was destroyed, clear the POI
            if (bb.farmChest) {
                console.log(`[BT] Farm chest missing, clearing POI`);
                bb.farmChest = null;
            }
            return 'failure';
        }

        console.log(`[BT] Depositing items at farm chest ${chestPos}`);
        bb.lastAction = 'deposit';

        try {
            await bot.pathfinder.goto(new GoalLookAtBlock(chestPos, bot.world));
            bot.pathfinder.stop();
            await sleep(200);

            const container = await bot.openContainer(chestBlock);

            // Deposit all produce
            const crops = ['wheat', 'carrot', 'potato', 'beetroot', 'poisonous_potato', 'melon_slice'];
            for (const item of bot.inventory.items()) {
                if (crops.includes(item.name)) {
                    try {
                        await container.deposit(item.type, null, item.count);
                    } catch { /* ignore if chest full */ }
                }
            }

            // Deposit excess seeds (keep 32 for planting)
            const seedTypes = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
            for (const seedType of seedTypes) {
                const seedItems = bot.inventory.items().filter(i => i.name === seedType);
                const totalSeeds = seedItems.reduce((sum, i) => sum + i.count, 0);
                if (totalSeeds > 32) {
                    const toDeposit = totalSeeds - 32;
                    for (const item of seedItems) {
                        if (toDeposit <= 0) break;
                        const amount = Math.min(item.count, toDeposit);
                        try {
                            await container.deposit(item.type, null, amount);
                        } catch { /* ignore if chest full */ }
                    }
                }
            }

            container.close();
            return 'success';
        } catch (err) {
            console.log(`[BT] Failed to deposit: ${err}`);
            return 'failure';
        }
    }
}
