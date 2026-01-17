import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';

/**
 * RequestMaterials - Request logs from lumberjack via chat
 *
 * The farmer requests logs (not planks/sticks) because:
 * 1. Logs are what the lumberjack naturally produces
 * 2. 1 log = 4 planks, so logs are more efficient to transport
 * 3. Farmer can craft planks/sticks from logs as needed
 */
export class RequestMaterials implements BehaviorNode {
    name = 'RequestMaterials';
    private lastRequestTime = 0;
    private REQUEST_COOLDOWN = 30000; // 30 seconds between requests

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Only request if we need tools and don't have materials
        if (!bb.needsTools) return 'failure';

        // Check if we have enough materials to craft a hoe:
        // Need: 2 planks (head) + 2 sticks (handle)
        // Which requires: 4 planks total (2 for sticks) = 1 log
        // But to be safe, request 2 logs (= 8 planks, enough for hoe + spare)
        const hasEnoughForHoe = (
            (bb.stickCount >= 2 && bb.plankCount >= 2) ||  // Direct materials
            bb.logCount >= 2  // 2 logs = 8 planks = enough for sticks + hoe
        );
        if (hasEnoughForHoe) return 'failure';
        if (!bb.villageChat) return 'failure';

        // Rate limit requests
        const now = Date.now();
        if (now - this.lastRequestTime < this.REQUEST_COOLDOWN) {
            // Already requested recently, just wait
            bb.lastAction = 'waiting_for_materials';
            return 'running';
        }

        // Check if we already have a pending request for logs
        if (bb.villageChat.hasPendingRequestFor('log')) {
            bb.lastAction = 'waiting_for_materials';
            return 'running';
        }

        bb.lastAction = 'request_materials';
        this.lastRequestTime = now;

        // Request logs (lumberjack deposits these naturally)
        // Request 2 logs = 8 planks, enough for hoe crafting
        console.log('[Farmer] Requesting 2 logs from lumberjack');
        bb.villageChat.requestResource('log', 2);

        return 'running'; // Wait for fulfillment
    }
}
