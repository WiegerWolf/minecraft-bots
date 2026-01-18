import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { FarmingBlackboard } from '../../Blackboard';
import { BaseCheckChest } from '../../../../shared/actions';

/**
 * CheckSharedChest - Check shared chest for materials and withdraw them.
 *
 * Farmer-specific behavior:
 * - Only checks when needs tools and doesn't have enough materials
 * - Withdraws logs (priority 1), planks (priority 2), sticks (priority 3)
 * - Uses village chat shared chest or finds chest near farm center
 */
export class CheckSharedChest extends BaseCheckChest<FarmingBlackboard> {
    constructor() {
        super({
            withdrawalPriorities: [
                { pattern: '_log', maxAmount: 4 },
                { pattern: '_planks', maxAmount: 8, onlyIfPreviousEmpty: true },
                { pattern: 'stick', maxAmount: 8 },
            ],
            roleLabel: 'Farmer',
            lastActionCheck: 'check_shared_chest',
            postPathfindSleepMs: 200,
            postOpenSleepMs: 100,
            betweenWithdrawSleepMs: 100,
        });
    }

    protected hasSufficientMaterials(bb: FarmingBlackboard): boolean {
        // Skip if we don't need tools
        if (!bb.needsTools) return true;

        // Check if we have enough materials to craft a hoe:
        // Need: 2 planks (head) + 2 sticks (handle)
        // Or: 2 logs (= 8 planks = enough for sticks + hoe)
        return (
            (bb.stickCount >= 2 && bb.plankCount >= 2) ||
            bb.logCount >= 2
        );
    }

    protected findChest(bot: Bot, bb: FarmingBlackboard): Vec3 | null {
        // Try village chat shared chest first
        const sharedChest = bb.villageChat?.getSharedChest();
        if (sharedChest) return sharedChest;

        // Look for a chest near farm center
        if (bb.nearbyChests.length > 0 && bb.farmCenter) {
            const sortedChests = [...bb.nearbyChests].sort((a, b) =>
                a.position.distanceTo(bb.farmCenter!) - b.position.distanceTo(bb.farmCenter!)
            );
            const chest = sortedChests[0];
            if (chest) {
                // Register as shared chest
                if (bb.villageChat) {
                    bb.villageChat.setSharedChest(chest.position);
                    bb.villageChat.announceSharedChest(chest.position);
                }
                return chest.position;
            }
        }

        return null;
    }
}
