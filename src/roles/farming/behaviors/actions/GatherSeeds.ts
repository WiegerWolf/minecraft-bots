import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

export class GatherSeeds implements BehaviorNode {
    name = 'GatherSeeds';
    private lastMaterialRequestTime = 0;
    private MATERIAL_REQUEST_COOLDOWN = 30000; // 30 seconds

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.needsSeeds) return 'failure';

        // While gathering seeds, also broadcast need for logs if we need a hoe
        if (bb.needsTools && bb.villageChat) {
            const hasEnoughForHoe = (
                (bb.stickCount >= 2 && bb.plankCount >= 2) ||
                bb.logCount >= 2
            );
            if (!hasEnoughForHoe) {
                const now = Date.now();
                if (now - this.lastMaterialRequestTime > this.MATERIAL_REQUEST_COOLDOWN) {
                    if (!bb.villageChat.hasPendingNeedFor('log')) {
                        bb.log?.debug('[Farmer] Broadcasting need for logs');
                        bb.villageChat.broadcastNeed('log');
                        this.lastMaterialRequestTime = now;
                    }
                }
            }
        }

        // If no grass in blackboard, try to find some directly
        let grass = bb.nearbyGrass[0];

        if (!grass) {
            // Try finding grass with expanded block names for different MC versions
            // Note: seagrass and tall_seagrass are excluded because they don't drop seeds
            const grassNames = [
                'short_grass', 'tall_grass', 'grass', 'fern', 'large_fern'
            ];

            const grassBlocks = bot.findBlocks({
                point: bot.entity.position,
                maxDistance: 64, // Increased range for navigation
                count: 1,
                matching: b => {
                    if (!b || !b.name) return false;
                    return grassNames.includes(b.name);
                }
            });

            if (grassBlocks.length > 0) {
                const pos = grassBlocks[0];
                if (pos) {
                    grass = bot.blockAt(pos) ?? undefined;
                }
            }
        }

        if (!grass) {
            bb.log?.debug(`[BT] No grass found nearby for seeds`);
            return 'failure';
        }

        bb.log?.debug(`[BT] Breaking ${grass.name} for seeds at ${grass.position}`);
        bb.lastAction = 'gather_seeds';

        try {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(grass.position.x, grass.position.y, grass.position.z, 2),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                bb.log?.debug(`[BT] Failed to reach grass: ${result.failureReason}`);
                return 'failure';
            }
            await bot.dig(grass);
            await sleep(300);
            return 'success';
        } catch (err) {
            bb.log?.debug(`[BT] Failed to gather seeds: ${err}`);
            return 'failure';
        }
    }
}
