import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { FarmingBlackboard } from '../../Blackboard';
import { BaseDepositItems } from '../../../../shared/actions';

/**
 * DepositItems - Deposit crops and excess seeds to farm chest.
 *
 * Farmer-specific behavior:
 * - Deposits when: inventory full OR 16+ produce OR 64+ seeds
 * - Prefers farm chest, falls back to nearby chests
 * - Keeps 32 seeds for planting
 */
export class DepositItems extends BaseDepositItems<FarmingBlackboard> {
    constructor() {
        super({
            depositFilter: {
                patterns: [
                    'wheat', 'carrot', 'potato', 'beetroot', 'poisonous_potato', 'melon_slice',
                    'wheat_seeds', 'beetroot_seeds'
                ],
                keepAmounts: {
                    'wheat_seeds': 32,
                    'beetroot_seeds': 32,
                    'carrot': 32,  // Carrots are both crop and seed
                    'potato': 32,  // Potatoes are both crop and seed
                },
            },
            roleLabel: 'Farmer',
            lastActionDeposit: 'deposit',
            postPathfindSleepMs: 200,
            betweenDepositSleepMs: 50,
        });
    }

    protected shouldDeposit(bb: FarmingBlackboard): boolean {
        return bb.inventoryFull || bb.produceCount >= 16 || bb.seedCount >= 64;
    }

    protected findChest(bot: Bot, bb: FarmingBlackboard): Vec3 | null {
        // Prefer farm chest, fall back to nearby chests
        if (bb.farmChest) return bb.farmChest;
        if (bb.nearbyChests.length > 0 && bb.nearbyChests[0]) {
            return bb.nearbyChests[0].position;
        }
        return null;
    }

    protected override onChestMissing(bb: FarmingBlackboard, chestPos: Vec3): void {
        // Clear farm chest POI if it was destroyed
        if (bb.farmChest && bb.farmChest.equals(chestPos)) {
            bb.log?.debug(`[Farmer] Farm chest missing, clearing POI`);
            bb.farmChest = null;
        }
    }
}
