import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';

/**
 * RequestMaterials - Request logs from lumberjack via chat
 *
 * The landscaper requests logs to craft tools (shovel, pickaxe).
 * Logs are what the lumberjack naturally produces and are efficient to transport.
 */
export class RequestMaterials implements BehaviorNode {
    name = 'RequestMaterials';
    private lastRequestTime = 0;
    private REQUEST_COOLDOWN = 30000; // 30 seconds between requests

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // Only request if we need tools and don't have materials
        if (!bb.needsTools) return 'failure';

        // Check if we have enough materials to craft tools:
        // Shovel: 1 plank + 2 sticks = 3 planks equivalent
        // Pickaxe: 3 planks + 2 sticks = 5 planks equivalent
        // Total worst case: 8 planks = 2 logs
        // But we might only need one tool, so check individually
        const hasShovelMaterials = bb.hasShovel || bb.logCount >= 1 || bb.plankCount >= 3;
        const hasPickaxeMaterials = bb.hasPickaxe || bb.logCount >= 2 || bb.plankCount >= 5;

        // If we have materials for all needed tools, no need to request
        if ((bb.hasShovel || hasShovelMaterials) && (bb.hasPickaxe || hasPickaxeMaterials)) {
            return 'failure';
        }

        if (!bb.villageChat) return 'failure';

        // Rate limit requests
        const now = Date.now();
        if (now - this.lastRequestTime < this.REQUEST_COOLDOWN) {
            // Already requested recently, just wait
            bb.lastAction = 'waiting_for_materials';
            return 'running';
        }

        // Check if we already have a pending request for logs - consider it success (request in progress)
        if (bb.villageChat.hasPendingRequestFor('log')) {
            bb.lastAction = 'waiting_for_materials';
            return 'success'; // Request already made, move on to check chest
        }

        bb.lastAction = 'request_materials';
        this.lastRequestTime = now;

        // Request logs - 2 logs = 8 planks, enough for both tools
        bb.log?.debug('[Landscaper] Requesting 2 logs from lumberjack for tool crafting');
        bb.villageChat.requestResource('log', 2);

        return 'success'; // Request made, next action should check chest for logs
    }
}
