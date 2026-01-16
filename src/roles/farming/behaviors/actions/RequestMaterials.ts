import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';

/**
 * RequestMaterials - Request sticks/planks from lumberjack via chat
 */
export class RequestMaterials implements BehaviorNode {
    name = 'RequestMaterials';
    private lastRequestTime = 0;
    private REQUEST_COOLDOWN = 30000; // 30 seconds between requests

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Only request if we need tools and don't have materials
        if (!bb.needsTools) return 'failure';
        if (bb.stickCount >= 2 && bb.plankCount >= 2) return 'failure';
        if (!bb.villageChat) return 'failure';

        // Rate limit requests
        const now = Date.now();
        if (now - this.lastRequestTime < this.REQUEST_COOLDOWN) {
            // Already requested recently, just wait
            bb.lastAction = 'waiting_for_materials';
            return 'running';
        }

        // Check if we already have a pending request
        if (bb.villageChat.hasPendingRequestFor('stick')) {
            bb.lastAction = 'waiting_for_materials';
            return 'running';
        }

        bb.lastAction = 'request_materials';
        this.lastRequestTime = now;

        // Request sticks if needed
        if (bb.stickCount < 2) {
            bb.villageChat.requestResource('stick', 4);
        }

        // Request planks if needed
        if (bb.plankCount < 2) {
            bb.villageChat.requestResource('planks', 4);
        }

        return 'running'; // Wait for fulfillment
    }
}
