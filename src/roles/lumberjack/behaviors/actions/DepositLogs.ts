import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { GoalGetToBlock } from 'baritone-ts';
import { LOG_NAMES } from '../../../shared/TreeHarvest';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';

// How long to remember a chest is full (5 minutes)
const FULL_CHEST_MEMORY_MS = 5 * 60 * 1000;

/**
 * DepositLogs - Put logs, planks, sticks, and saplings in shared chest
 *
 * Deposits more frequently (8+ logs instead of 16+) to ensure farmer
 * can get materials quickly. Also announces deposits via chat.
 */
export class DepositLogs implements BehaviorNode {
    name = 'DepositLogs';

    private posToKey(pos: { x: number; y: number; z: number }): string {
        return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    }

    private cleanupFullChests(bb: LumberjackBlackboard): void {
        const now = Date.now();
        for (const [key, expiry] of bb.fullChests) {
            if (now >= expiry) {
                bb.fullChests.delete(key);
            }
        }
    }

    private isChestFull(bb: LumberjackBlackboard, pos: { x: number; y: number; z: number }): boolean {
        const key = this.posToKey(pos);
        const expiry = bb.fullChests.get(key);
        if (!expiry) return false;
        if (Date.now() >= expiry) {
            bb.fullChests.delete(key);
            return false;
        }
        return true;
    }

    private markChestFull(bb: LumberjackBlackboard, pos: { x: number; y: number; z: number }): void {
        const key = this.posToKey(pos);
        bb.fullChests.set(key, Date.now() + FULL_CHEST_MEMORY_MS);
        bb.log?.info({ chestPos: key, expiresIn: '5 minutes' }, 'Marked chest as full');
    }

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Clean up expired full chest entries
        this.cleanupFullChests(bb);

        // Check if there are incoming needs we could help with
        const hasIncomingNeeds = bb.hasIncomingNeeds;

        // Deposit threshold: 8+ logs normally, or any logs if there's an incoming need
        const totalWoodItems = bb.logCount + bb.plankCount + bb.stickCount;
        const shouldDeposit = (
            bb.inventoryFull ||
            totalWoodItems >= 8 ||
            (hasIncomingNeeds && bb.logCount > 0)
        );

        if (!shouldDeposit) {
            return 'failure';
        }

        // Find or use shared chest
        let chestPos = bb.sharedChest;

        // If shared chest is marked as full, clear it
        if (chestPos && this.isChestFull(bb, chestPos)) {
            bb.log?.debug({ chestPos: chestPos.toString() }, 'Shared chest is marked full, looking for another');
            bb.sharedChest = null;
            chestPos = null;
        }

        if (!chestPos) {
            // IMPORTANT: Only use KNOWN chests (from signs, village chat, or bot-placed)
            // Do NOT adopt random found chests - they may be underground, in ruins, etc.
            // Bot-placed chests are added to knownChests when placed by PlaceStorageChest
            const availableChests = bb.knownChests
                .filter(pos => !this.isChestFull(bb, pos))
                .sort((a, b) => {
                    const botPos = bot.entity.position;
                    return a.distanceTo(botPos) - b.distanceTo(botPos);
                });

            if (availableChests.length > 0) {
                chestPos = availableChests[0]!;
                bb.sharedChest = chestPos;

                // Announce to village if not already shared
                if (bb.villageChat) {
                    bb.villageChat.announceSharedChest(chestPos);
                }

                bb.log?.info({ chestPos: chestPos.toString() }, 'Using known chest for deposits');
            } else {
                // No known chests - need to place one first
                bb.log?.debug('No known chests available - need to place storage chest first');
                return 'failure';
            }
        }

        const chest = bot.blockAt(chestPos);
        if (!chest || !['chest', 'barrel'].includes(chest.name)) {
            bb.log?.debug(`[Lumberjack] Shared chest no longer exists at ${chestPos}`);
            bb.sharedChest = null;
            return 'failure';
        }

        bb.lastAction = 'deposit_logs';
        bb.log?.debug(`[Lumberjack] Depositing items to chest at ${chestPos}`);

        try {
            const success = await pathfinderGotoWithRetry(bot, new GoalGetToBlock(chest.position.x, chest.position.y, chest.position.z));
            if (!success) {
                bb.log?.warn(`[Lumberjack] Failed to reach chest after retries`);
                return 'failure';
            }

            const chestWindow = await bot.openContainer(chest);
            await sleep(100);

            // Deposit wood-related items (keep saplings for replanting)
            const itemsToDeposit = bot.inventory.items().filter(item =>
                LOG_NAMES.includes(item.name) ||
                item.name.endsWith('_planks') ||
                item.name === 'stick'
            );

            let deposited = 0;
            let logsDeposited = 0;
            for (const item of itemsToDeposit) {
                try {
                    await chestWindow.deposit(item.type, null, item.count);
                    deposited += item.count;
                    if (LOG_NAMES.includes(item.name)) {
                        logsDeposited += item.count;
                    }
                    await sleep(50);
                } catch (err) {
                    // Chest might be full
                    bb.log?.debug(`[Lumberjack] Failed to deposit ${item.name}: ${err}`);
                    break;
                }
            }

            chestWindow.close();

            // If we had items to deposit but deposited nothing, chest is full
            if (itemsToDeposit.length > 0 && deposited === 0) {
                bb.log?.warn({ chestPos: chestPos.toString() }, 'Chest is full, marking as full');
                this.markChestFull(bb, chestPos);
                // Don't clear sharedChest from VillageChat - other bots still need to know about it
                // When a farmer empties it, it will become usable again (fullChests has 5min expiry)
                return 'failure';
            }

            bb.log?.debug(`[Lumberjack] Deposited ${deposited} items (${logsDeposited} logs)`);

            // Announce deposit via chat so farmer knows materials are available
            if (logsDeposited > 0 && bb.villageChat) {
                bb.villageChat.announceDeposit('logs', logsDeposited);
            }

            return 'success';
        } catch (error) {
            bb.log?.warn({ err: error }, 'Error depositing items');
            return 'failure';
        }
    }
}
