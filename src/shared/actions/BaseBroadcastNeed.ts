import type { Bot } from 'mineflayer';
import type { VillageChat } from '../VillageChat';
import type { Logger } from '../logger';
import type { Need, NeedOffer } from '../needs/types';
import { DEFAULT_NEED_CONFIG } from '../needs/types';

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * Minimal blackboard interface required by BaseBroadcastNeed.
 * Role-specific blackboards should extend this.
 */
export interface BroadcastNeedBlackboard {
    needsTools: boolean;
    villageChat: VillageChat | null;
    lastAction: string;
    log?: Logger | null;
}

/**
 * Configuration options for need broadcast behavior.
 */
export interface BroadcastNeedConfig {
    /** Cooldown between broadcasts in ms (default: 30000) */
    broadcastCooldownMs?: number;
    /** Category to broadcast need for (default: 'hoe') */
    needCategory?: string;
    /** How long to collect offers in ms (default: 30000) */
    offerWindowMs?: number;
    /** How long before expiring need in ms (default: 300000) */
    expirationMs?: number;
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** Log level for broadcast message: 'info' or 'debug' (default: 'info') */
    logLevel?: 'info' | 'debug';
    /** Return status when need is active (default: 'running') */
    activeReturnStatus?: BehaviorStatus;
    /** Return status after broadcasting (default: 'running') */
    broadcastedReturnStatus?: BehaviorStatus;
}

const DEFAULT_CONFIG: Required<BroadcastNeedConfig> = {
    broadcastCooldownMs: 30000,
    needCategory: 'hoe',
    offerWindowMs: DEFAULT_NEED_CONFIG.offerWindowMs,
    expirationMs: DEFAULT_NEED_CONFIG.expirationMs,
    roleLabel: 'Bot',
    logLevel: 'info',
    activeReturnStatus: 'running',
    broadcastedReturnStatus: 'running',
};

/**
 * State tracking for the active need within this action.
 */
interface ActiveNeedState {
    needId: string;
    broadcastTime: number;
    status: 'broadcasting' | 'collecting' | 'accepted' | 'awaiting_delivery';
    selectedProvider: string | null;
}

/**
 * Base class for broadcasting needs to other bots via village chat.
 *
 * Handles:
 * - Broadcasting a need for an item category
 * - Collecting offers during the window period
 * - Selecting the best offer
 * - Accepting a provider
 *
 * Subclasses must implement:
 * - `hasSufficientItems()` to define when the need is satisfied
 * - `shouldBroadcast()` to define additional conditions for broadcasting
 *
 * Usage:
 * ```typescript
 * export class BroadcastNeed extends BaseBroadcastNeed<MyBlackboard> {
 *     constructor() {
 *         super({ roleLabel: 'Farmer', needCategory: 'hoe' });
 *     }
 *
 *     protected hasSufficientItems(bb: MyBlackboard): boolean {
 *         return bb.hasHoe || bb.hasToolMaterials;
 *     }
 *
 *     protected shouldBroadcast(bb: MyBlackboard): boolean {
 *         return bb.needsTools;
 *     }
 * }
 * ```
 */
export abstract class BaseBroadcastNeed<TBlackboard extends BroadcastNeedBlackboard> {
    readonly name = 'BroadcastNeed';
    protected config: Required<BroadcastNeedConfig>;
    private lastBroadcastTime = 0;
    private activeNeedState: ActiveNeedState | null = null;

    constructor(config?: BroadcastNeedConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if the bot has sufficient items and doesn't need to broadcast.
     * Subclasses must implement this based on their specific requirements.
     */
    protected abstract hasSufficientItems(bb: TBlackboard): boolean;

    /**
     * Additional conditions for broadcasting a need.
     * Default returns true if needsTools is set.
     */
    protected shouldBroadcast(bb: TBlackboard): boolean {
        return bb.needsTools;
    }

    /**
     * Called when a provider is accepted. Override to handle delivery coordination.
     */
    protected onProviderAccepted(
        bot: Bot,
        bb: TBlackboard,
        needId: string,
        provider: string,
        offer: NeedOffer
    ): void {
        bb.log?.info({ needId, provider, items: offer.items }, 'Provider accepted');
    }

    /**
     * Called when the need is fulfilled. Override to handle completion.
     */
    protected onNeedFulfilled(bot: Bot, bb: TBlackboard, needId: string): void {
        bb.log?.info({ needId }, 'Need fulfilled');
    }

    /**
     * Called when the need expires. Override to handle failure.
     */
    protected onNeedExpired(bot: Bot, bb: TBlackboard, needId: string): void {
        bb.log?.warn({ needId }, 'Need expired without fulfillment');
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        // Check if we should even be doing this
        if (!this.shouldBroadcast(bb)) {
            this.cleanupActiveNeed(bb);
            return 'failure';
        }

        // Check if we already have what we need
        if (this.hasSufficientItems(bb)) {
            this.cleanupActiveNeed(bb);
            return 'failure';
        }

        // Need village chat to broadcast
        if (!bb.villageChat) return 'failure';

        const now = Date.now();

        // If we have an active need, manage its lifecycle
        if (this.activeNeedState) {
            return this.manageActiveNeed(bot, bb, now);
        }

        // Rate limit broadcasts
        if (now - this.lastBroadcastTime < this.config.broadcastCooldownMs) {
            bb.lastAction = 'waiting_for_need_response';
            return this.config.activeReturnStatus;
        }

        // Check if we already have a pending need for this category
        if (bb.villageChat.hasPendingNeedFor(this.config.needCategory)) {
            bb.lastAction = 'waiting_for_need_response';
            return this.config.activeReturnStatus;
        }

        // Broadcast the need
        return this.broadcastNeed(bot, bb, now);
    }

    /**
     * Broadcast a new need.
     */
    private broadcastNeed(bot: Bot, bb: TBlackboard, now: number): BehaviorStatus {
        bb.lastAction = 'broadcast_need';
        this.lastBroadcastTime = now;

        const needId = bb.villageChat!.broadcastNeed(this.config.needCategory);

        this.activeNeedState = {
            needId,
            broadcastTime: now,
            status: 'broadcasting',
            selectedProvider: null,
        };

        const message = `[${this.config.roleLabel}] Broadcasting need for ${this.config.needCategory}`;
        if (this.config.logLevel === 'info') {
            bb.log?.info(message);
        } else {
            bb.log?.debug(message);
        }

        return this.config.broadcastedReturnStatus;
    }

    /**
     * Manage an active need through its lifecycle.
     */
    private manageActiveNeed(
        bot: Bot,
        bb: TBlackboard,
        now: number
    ): BehaviorStatus {
        const state = this.activeNeedState!;
        const elapsed = now - state.broadcastTime;

        // Check for expiration
        if (elapsed > this.config.expirationMs) {
            this.expireNeed(bot, bb);
            return 'failure';
        }

        // Get the current need from VillageChat
        const need = bb.villageChat!.getNeedById(state.needId);
        if (!need) {
            // Need was cleaned up externally
            this.cleanupActiveNeed(bb);
            return 'failure';
        }

        switch (state.status) {
            case 'broadcasting':
                return this.handleBroadcastingPhase(bot, bb, now, elapsed, need);

            case 'collecting':
                return this.handleCollectingPhase(bot, bb, now, elapsed, need);

            case 'accepted':
            case 'awaiting_delivery':
                return this.handleAwaitingDeliveryPhase(bot, bb, need);

            default:
                return this.config.activeReturnStatus;
        }
    }

    /**
     * Handle the initial broadcasting phase (collecting offers).
     */
    private handleBroadcastingPhase(
        bot: Bot,
        bb: TBlackboard,
        now: number,
        elapsed: number,
        need: Need
    ): BehaviorStatus {
        bb.lastAction = 'collecting_offers';

        // After the offer window, move to collecting phase to select provider
        if (elapsed >= this.config.offerWindowMs) {
            this.activeNeedState!.status = 'collecting';
            return this.handleCollectingPhase(bot, bb, now, elapsed, need);
        }

        return this.config.activeReturnStatus;
    }

    /**
     * Handle the collecting phase (select best offer and accept provider).
     */
    private handleCollectingPhase(
        bot: Bot,
        bb: TBlackboard,
        _now: number,
        _elapsed: number,
        need: Need
    ): BehaviorStatus {
        bb.lastAction = 'selecting_provider';

        // Get ranked offers
        const offers = bb.villageChat!.getRankedOffersForNeed(need.id);

        if (offers.length === 0) {
            bb.log?.debug({ needId: need.id }, 'No offers received, waiting...');
            // Continue waiting, might get late offers
            return this.config.activeReturnStatus;
        }

        // Select best offer (first in ranked list)
        const bestOffer = offers[0]!;
        this.activeNeedState!.selectedProvider = bestOffer.from;
        this.activeNeedState!.status = 'accepted';

        // Accept the provider
        bb.villageChat!.acceptProvider(need.id, bestOffer.from);

        this.onProviderAccepted(bot, bb, need.id, bestOffer.from, bestOffer);

        return this.config.activeReturnStatus;
    }

    /**
     * Handle awaiting delivery phase.
     */
    private handleAwaitingDeliveryPhase(
        _bot: Bot,
        bb: TBlackboard,
        need: Need
    ): BehaviorStatus {
        bb.lastAction = 'awaiting_delivery';

        // Check if delivery location has been announced
        if (need.deliveryLocation && need.deliveryMethod) {
            bb.log?.info(
                {
                    needId: need.id,
                    method: need.deliveryMethod,
                    location: need.deliveryLocation.toString(),
                },
                'Delivery location received'
            );
            this.activeNeedState!.status = 'awaiting_delivery';
        }

        // The actual pickup will be handled by other actions (CheckSharedChest, trade flow)
        // We just monitor the need status here

        if (need.status === 'fulfilled') {
            this.fulfillNeed(_bot, bb);
            return 'success';
        }

        return this.config.activeReturnStatus;
    }

    /**
     * Mark the need as fulfilled and cleanup.
     */
    private fulfillNeed(bot: Bot, bb: TBlackboard): void {
        if (!this.activeNeedState) return;

        const needId = this.activeNeedState.needId;
        bb.villageChat?.markNeedFulfilled(needId);

        this.onNeedFulfilled(bot, bb, needId);
        this.cleanupActiveNeed(bb);
    }

    /**
     * Mark the need as expired and cleanup.
     */
    private expireNeed(bot: Bot, bb: TBlackboard): void {
        if (!this.activeNeedState) return;

        const needId = this.activeNeedState.needId;
        bb.villageChat?.markNeedExpired(needId);

        this.onNeedExpired(bot, bb, needId);
        this.cleanupActiveNeed(bb);
    }

    /**
     * Cleanup active need state.
     */
    private cleanupActiveNeed(_bb: TBlackboard): void {
        this.activeNeedState = null;
    }

    /**
     * Get the current active need ID (for external monitoring).
     */
    getActiveNeedId(): string | null {
        return this.activeNeedState?.needId ?? null;
    }

    /**
     * Get the selected provider (for external monitoring).
     */
    getSelectedProvider(): string | null {
        return this.activeNeedState?.selectedProvider ?? null;
    }

    /**
     * Force expire the current need (for testing or manual intervention).
     */
    forceExpire(bot: Bot, bb: TBlackboard): void {
        this.expireNeed(bot, bb);
    }
}
