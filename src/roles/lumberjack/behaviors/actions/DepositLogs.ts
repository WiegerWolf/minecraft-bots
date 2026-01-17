import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { LOG_NAMES } from '../../../shared/TreeHarvest';
import { pathfinderGotoWithRetry } from './utils';

const { GoalLookAtBlock } = goals;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

        // Check if there are pending requests for wood-related items
        const hasPendingRequests = bb.villageChat?.hasPendingRequestsToFulfill(['log', 'plank', 'stick']) ?? false;

        // Deposit threshold: 8+ logs normally, or any logs if there's a pending request
        const totalWoodItems = bb.logCount + bb.plankCount + bb.stickCount;
        const shouldDeposit = (
            bb.inventoryFull ||
            totalWoodItems >= 8 ||
            (hasPendingRequests && bb.logCount > 0)
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
            // Collect all known chest positions: from signs + nearby perception
            const allChestPositions = [...bb.knownChests];

            // Add nearby chests that aren't already in knownChests
            for (const nearby of bb.nearbyChests) {
                const alreadyKnown = allChestPositions.some(
                    known => known.distanceTo(nearby.position) < 2
                );
                if (!alreadyKnown) {
                    allChestPositions.push(nearby.position.clone());
                }
            }

            // Sort by distance from bot and filter out full ones
            const botPos = bot.entity.position;
            const availableChests = allChestPositions
                .filter(pos => !this.isChestFull(bb, pos))
                .sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

            if (availableChests.length > 0) {
                chestPos = availableChests[0]!;

                // Add to knownChests if not already there
                const alreadyInKnown = bb.knownChests.some(k => k.distanceTo(chestPos!) < 2);
                if (!alreadyInKnown) {
                    bb.knownChests.push(chestPos.clone());

                    // Queue sign write for newly discovered chest
                    if (bb.spawnPosition) {
                        bb.pendingSignWrites.push({
                            type: 'CHEST',
                            pos: chestPos.clone()
                        });
                        bb.log?.debug({ type: 'CHEST', pos: chestPos.toString() }, 'Queued sign write for discovered chest');
                    }
                }

                // Register as shared chest and announce
                bb.sharedChest = chestPos;
                if (bb.villageChat) {
                    bb.villageChat.announceSharedChest(chestPos);
                }

                bb.log?.info({ chestPos: chestPos.toString() }, 'Selected closest available chest');
            } else {
                bb.log?.debug('No available (non-full) chests found');
                return 'failure'; // No chest available
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
            const success = await pathfinderGotoWithRetry(bot, new GoalLookAtBlock(chest.position, bot.world, { reach: 4 }));
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
                bb.log?.warn({ chestPos: chestPos.toString() }, 'Chest is full, marking as full and clearing shared chest');
                this.markChestFull(bb, chestPos);
                bb.sharedChest = null;
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
