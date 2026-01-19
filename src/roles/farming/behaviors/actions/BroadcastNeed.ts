import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import { BaseBroadcastNeed } from '../../../../shared/actions/BaseBroadcastNeed';
import type { NeedOffer } from '../../../../shared/needs/types';

/**
 * BroadcastNeed - Broadcast intent-based need for tools via the new need system.
 *
 * Unlike RequestMaterials which requests specific items (logs), this action
 * broadcasts an abstract need (hoe) and lets other bots offer what they can:
 * - A hoe directly (any type: wooden, stone, iron, etc.)
 * - Materials to craft a hoe (planks + sticks)
 * - Raw materials (logs)
 *
 * The best offer is selected based on:
 * - Crafting steps (fewer is better - a hoe beats materials)
 * - Completeness (full satisfaction beats partial)
 * - Timestamp (earlier responders win ties)
 */
export class BroadcastNeed extends BaseBroadcastNeed<FarmingBlackboard> {
    constructor() {
        super({
            roleLabel: 'Farmer',
            needCategory: 'hoe',
            offerWindowMs: 30000, // 30 seconds to collect offers
            expirationMs: 300000, // 5 minutes before giving up
            logLevel: 'info',
            activeReturnStatus: 'running',
            broadcastedReturnStatus: 'running',
        });
    }

    /**
     * Check if farmer already has what they need.
     * Returns true if we have a hoe or enough materials to craft one.
     */
    protected hasSufficientItems(bb: FarmingBlackboard): boolean {
        // Already have a hoe
        if (bb.hasHoe) return true;

        // Have direct materials to craft a hoe (2 planks + 2 sticks)
        if (bb.stickCount >= 2 && bb.plankCount >= 2) return true;

        // Have logs that can be converted to planks/sticks (2 logs = 8 planks = hoe + spare)
        if (bb.logCount >= 2) return true;

        return false;
    }

    /**
     * Additional condition: only broadcast if we actually need tools.
     */
    protected override shouldBroadcast(bb: FarmingBlackboard): boolean {
        return bb.needsTools;
    }

    /**
     * When a provider is accepted, log the details and update blackboard.
     */
    protected override onProviderAccepted(
        _bot: Bot,
        bb: FarmingBlackboard,
        needId: string,
        provider: string,
        offer: NeedOffer
    ): void {
        bb.log?.info(
            {
                needId,
                provider,
                offerType: offer.type,
                items: offer.items.map(i => `${i.count}x ${i.name}`).join(', '),
                craftingSteps: offer.craftingSteps,
            },
            `[Farmer] Accepted ${provider}'s offer for hoe need`
        );

        // Store info about what we're expecting
        // The actual pickup is handled by CheckSharedChest or trade actions
    }

    /**
     * When the need is fulfilled, log success.
     */
    protected override onNeedFulfilled(_bot: Bot, bb: FarmingBlackboard, needId: string): void {
        bb.log?.info({ needId }, '[Farmer] Hoe need fulfilled');
    }

    /**
     * When the need expires, log and potentially trigger fallback.
     */
    protected override onNeedExpired(_bot: Bot, bb: FarmingBlackboard, needId: string): void {
        bb.log?.warn(
            { needId },
            '[Farmer] Hoe need expired without fulfillment - will try again'
        );
        // The tick loop will naturally try again after cooldown
    }
}
