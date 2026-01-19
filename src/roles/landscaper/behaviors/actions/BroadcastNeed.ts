import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BaseBroadcastNeed } from '../../../../shared/actions/BaseBroadcastNeed';
import type { NeedOffer } from '../../../../shared/needs/types';

/**
 * BroadcastNeed - Broadcast intent-based need for tools via the new need system.
 *
 * The landscaper needs both a shovel and pickaxe. This action broadcasts needs
 * for whichever tools are missing, prioritizing shovel (more commonly used).
 *
 * The best offer is selected based on:
 * - Crafting steps (fewer is better - a tool beats materials)
 * - Completeness (full satisfaction beats partial)
 * - Timestamp (earlier responders win ties)
 */
export class BroadcastNeed extends BaseBroadcastNeed<LandscaperBlackboard> {
    private currentNeedCategory: 'shovel' | 'pickaxe' = 'shovel';

    constructor() {
        super({
            roleLabel: 'Landscaper',
            needCategory: 'shovel', // Will be updated dynamically
            offerWindowMs: 30000,
            expirationMs: 300000,
            logLevel: 'debug',
            activeReturnStatus: 'success', // Landscaper returns success when need active
            broadcastedReturnStatus: 'success',
        });
    }

    /**
     * Determine which tool to request based on what's missing.
     * Prioritize shovel over pickaxe.
     */
    private determineNeedCategory(bb: LandscaperBlackboard): 'shovel' | 'pickaxe' | null {
        // Check if we need a shovel
        if (!bb.hasShovel && !this.hasShovelMaterials(bb)) {
            return 'shovel';
        }

        // Check if we need a pickaxe
        if (!bb.hasPickaxe && !this.hasPickaxeMaterials(bb)) {
            return 'pickaxe';
        }

        return null;
    }

    private hasShovelMaterials(bb: LandscaperBlackboard): boolean {
        // Shovel: 1 plank + 2 sticks (or 3 planks, or 1 log)
        return bb.logCount >= 1 || bb.plankCount >= 3 || (bb.plankCount >= 1 && bb.stickCount >= 2);
    }

    private hasPickaxeMaterials(bb: LandscaperBlackboard): boolean {
        // Pickaxe: 3 planks + 2 sticks (or 5 planks, or 2 logs)
        return bb.logCount >= 2 || bb.plankCount >= 5 || (bb.plankCount >= 3 && bb.stickCount >= 2);
    }

    /**
     * Check if landscaper already has what they need.
     */
    protected override hasSufficientItems(bb: LandscaperBlackboard): boolean {
        const neededCategory = this.determineNeedCategory(bb);
        if (neededCategory === null) {
            return true; // Have everything we need
        }

        // Update the category we're requesting
        this.currentNeedCategory = neededCategory;
        this.config.needCategory = neededCategory;

        return false;
    }

    /**
     * Additional condition: only broadcast if we actually need tools.
     */
    protected override shouldBroadcast(bb: LandscaperBlackboard): boolean {
        return bb.needsTools;
    }

    /**
     * When a provider is accepted, log the details.
     */
    protected override onProviderAccepted(
        _bot: Bot,
        bb: LandscaperBlackboard,
        needId: string,
        provider: string,
        offer: NeedOffer
    ): void {
        bb.log?.info(
            {
                needId,
                provider,
                tool: this.currentNeedCategory,
                offerType: offer.type,
                items: offer.items.map(i => `${i.count}x ${i.name}`).join(', '),
            },
            `[Landscaper] Accepted ${provider}'s offer for ${this.currentNeedCategory}`
        );
    }

    /**
     * When the need is fulfilled, log success.
     */
    protected override onNeedFulfilled(_bot: Bot, bb: LandscaperBlackboard, needId: string): void {
        bb.log?.info(
            { needId, tool: this.currentNeedCategory },
            `[Landscaper] ${this.currentNeedCategory} need fulfilled`
        );
    }

    /**
     * When the need expires, log and potentially trigger fallback.
     */
    protected override onNeedExpired(_bot: Bot, bb: LandscaperBlackboard, needId: string): void {
        bb.log?.warn(
            { needId, tool: this.currentNeedCategory },
            `[Landscaper] ${this.currentNeedCategory} need expired - will try again`
        );
    }
}
