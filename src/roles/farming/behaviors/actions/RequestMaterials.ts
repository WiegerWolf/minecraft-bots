import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { villageManager } from '../../../../shared/VillageState';

/**
 * RequestMaterials - Request sticks/planks from lumberjack when farmer needs tools
 */
export class RequestMaterials implements BehaviorNode {
    name = 'RequestMaterials';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Only request if we need tools and don't have materials
        if (!bb.needsTools) return 'failure';
        if (bb.stickCount >= 2 && bb.plankCount >= 2) return 'failure';

        bb.lastAction = 'request_materials';

        // Check if we already have an active request
        try {
            const hasRequest = await villageManager.hasUnfulfilledRequestFor(bot.username, 'stick');
            if (hasRequest) {
                console.log('[Farmer] Already have pending stick request, waiting...');
                return 'running';
            }
        } catch (error) {
            console.warn('[Farmer] Failed to check existing requests:', error);
        }

        // Submit request to lumberjack
        try {
            await villageManager.requestResource(bot.username, 'stick', 4);
            console.log('[Farmer] Requested 4 sticks from lumberjack');

            // Also request planks if needed
            if (bb.plankCount < 2) {
                await villageManager.requestResource(bot.username, 'planks', 4);
                console.log('[Farmer] Requested 4 planks from lumberjack');
            }

            return 'running'; // Wait for fulfillment
        } catch (error) {
            console.warn('[Farmer] Failed to request materials:', error);
            return 'failure';
        }
    }
}
