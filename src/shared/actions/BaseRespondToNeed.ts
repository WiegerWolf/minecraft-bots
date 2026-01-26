import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import type { VillageChat } from '../VillageChat';
import type { Logger } from '../logger';
import type { Need, NeedOffer, ItemStack, DeliveryMethod } from '../needs/types';
import { RecipeService } from '../needs/RecipeService';
import { smartPathfinderGoto } from '../PathfindingUtils';

const { GoalNear } = goals;

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * Minimal blackboard interface required by BaseRespondToNeed.
 * Role-specific blackboards should extend this.
 */
export interface RespondToNeedBlackboard {
    villageChat: VillageChat | null;
    lastAction: string;
    log?: Logger | null;
}

/**
 * Configuration options for need response behavior.
 */
export interface RespondToNeedConfig {
    /** Categories this bot can provide for (default: ['log', 'planks', 'stick']) */
    canProvideCategories?: string[];
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** Log level: 'info' or 'debug' (default: 'info') */
    logLevel?: 'info' | 'debug';
    /** Minecraft version for recipe service (default: '1.20.4') */
    mcVersion?: string;
}

const DEFAULT_CONFIG: Required<RespondToNeedConfig> = {
    canProvideCategories: ['log', 'planks', 'stick'],
    roleLabel: 'Bot',
    logLevel: 'info',
    mcVersion: '1.20.4',
};

/**
 * State tracking for a need we're responding to.
 */
interface RespondingNeedState {
    needId: string;
    from: string;
    category: string;
    offer: NeedOffer;
    status: 'offered' | 'accepted' | 'delivering' | 'delivered';
    deliveryMethod: DeliveryMethod | null;
    deliveryLocation: Vec3 | null;
}

/**
 * Base class for responding to needs from other bots.
 *
 * Handles:
 * - Listening for incoming needs
 * - Checking inventory for what can satisfy the need
 * - Sending offers
 * - Delivering items when accepted
 *
 * Subclasses must implement:
 * - `getInventory()` to provide current inventory
 * - `canSpareItems()` to check if we can give away items
 *
 * Usage:
 * ```typescript
 * export class RespondToNeed extends BaseRespondToNeed<MyBlackboard> {
 *     constructor() {
 *         super({ roleLabel: 'Lumberjack', canProvideCategories: ['log', 'planks', 'stick'] });
 *     }
 *
 *     protected getInventory(bb: MyBlackboard): ItemStack[] {
 *         return bb.inventory.map(i => ({ name: i.name, count: i.count }));
 *     }
 *
 *     protected canSpareItems(bb: MyBlackboard, items: ItemStack[]): boolean {
 *         // Check if we can give these items without hurting ourselves
 *         return bb.logCount > items.reduce((sum, i) => sum + i.count, 0);
 *     }
 * }
 * ```
 */
export abstract class BaseRespondToNeed<TBlackboard extends RespondToNeedBlackboard> {
    readonly name = 'RespondToNeed';
    protected config: Required<RespondToNeedConfig>;
    private recipeService: RecipeService;
    private respondingNeeds: Map<string, RespondingNeedState> = new Map();

    constructor(config?: RespondToNeedConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.recipeService = RecipeService.getInstance(this.config.mcVersion);
    }

    /**
     * Get the current inventory as ItemStacks.
     * Subclasses must implement this.
     * @param bot The bot instance (for scanning actual inventory)
     * @param bb The blackboard (for cached inventory state)
     */
    protected abstract getInventory(bot: Bot, bb: TBlackboard): ItemStack[];

    /**
     * Check if we can spare the given items.
     * Subclasses must implement this.
     */
    protected abstract canSpareItems(bb: TBlackboard, items: ItemStack[]): boolean;

    /**
     * Called when we send an offer. Override for custom behavior.
     */
    protected onOfferSent(
        _bot: Bot,
        bb: TBlackboard,
        needId: string,
        offer: NeedOffer
    ): void {
        bb.log?.info(
            {
                needId,
                items: offer.items.map(i => `${i.count}x ${i.name}`).join(', '),
            },
            `[${this.config.roleLabel}] Sent offer for need`
        );
    }

    /**
     * Called when our offer is accepted. Override for custom behavior.
     */
    protected onOfferAccepted(
        _bot: Bot,
        bb: TBlackboard,
        needId: string,
        requester: string
    ): void {
        bb.log?.info(
            { needId, requester },
            `[${this.config.roleLabel}] Our offer was accepted`
        );
    }

    /**
     * Called when delivery is complete. Override for custom behavior.
     */
    protected onDeliveryComplete(
        _bot: Bot,
        bb: TBlackboard,
        needId: string
    ): void {
        bb.log?.info(
            { needId },
            `[${this.config.roleLabel}] Delivery complete`
        );
    }

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        // Need village chat to respond to needs
        if (!bb.villageChat) return 'failure';

        // First, handle any needs we're currently responding to
        const handlingResult = await this.handleRespondingNeeds(bot, bb);
        if (handlingResult === 'running') {
            return 'running';
        }

        // Look for new needs to respond to
        const newNeedsHandled = await this.handleNewNeeds(bot, bb);
        if (newNeedsHandled) {
            return 'running';
        }

        return 'failure';
    }

    /**
     * Handle needs we've already offered for.
     */
    private async handleRespondingNeeds(
        bot: Bot,
        bb: TBlackboard
    ): Promise<BehaviorStatus> {
        let hasPendingOffers = false;

        for (const [needId, state] of this.respondingNeeds) {
            // Check if the need still exists (might have been fulfilled by someone else)
            const need = bb.villageChat!.getNeedById(needId);
            if (!need || need.status === 'fulfilled' || need.status === 'expired') {
                // Need is gone, clean up our tracking
                this.respondingNeeds.delete(needId);
                continue;
            }

            // Check if we're accepted as provider
            const isAccepted = bb.villageChat!.isAcceptedProviderFor(needId);

            if (state.status === 'offered' && isAccepted) {
                // Our offer was accepted!
                state.status = 'accepted';
                this.onOfferAccepted(bot, bb, needId, need.from);

                // Determine delivery method and announce
                return await this.initiateDelivery(bot, bb, state);
            }

            if (state.status === 'offered' && !isAccepted) {
                // Still waiting for acceptance - mark that we have pending work
                hasPendingOffers = true;
                bb.lastAction = 'waiting_for_acceptance';
            }

            if (state.status === 'delivering') {
                bb.lastAction = 'delivering_need';
                // Actually perform delivery
                const result = await this.performDelivery(bot, bb, state);
                if (result === 'success') {
                    state.status = 'delivered';
                    bb.villageChat!.markNeedFulfilled(state.needId);
                }
                return result;
            }

            if (state.status === 'delivered') {
                // Clean up
                this.respondingNeeds.delete(needId);
                this.onDeliveryComplete(bot, bb, needId);
            }
        }

        // If we have pending offers, keep running (don't fail immediately)
        if (hasPendingOffers) {
            return 'running';
        }

        return 'failure';
    }

    /**
     * Look for new needs and offer to help.
     */
    private async handleNewNeeds(bot: Bot, bb: TBlackboard): Promise<boolean> {
        const incomingNeeds = bb.villageChat!.getIncomingBroadcastingNeeds();

        if (incomingNeeds.length === 0) {
            return false;
        }

        for (const need of incomingNeeds) {

            // Skip if we're already responding to this need
            if (this.respondingNeeds.has(need.id)) {
                continue;
            }

            // Check if this is a category we can provide for
            if (!this.canProvideForCategory(need.category)) {
                continue;
            }

            // Check what we can offer
            const inventory = this.getInventory(bot, bb);
            const satisfaction = this.recipeService.whatCanSatisfy(
                need.category,
                inventory,
                bot.username
            );

            if (!satisfaction.canSatisfy || !satisfaction.bestOffer) {
                continue;
            }

            // Check if we can spare the items
            const canSpare = this.canSpareItems(bb, satisfaction.bestOffer.items);
            if (!canSpare) {
                continue;
            }

            // Send the offer
            const offer = satisfaction.bestOffer;
            bb.villageChat!.offerForNeed(need.id, offer);

            // Track that we're responding to this need
            this.respondingNeeds.set(need.id, {
                needId: need.id,
                from: need.from,
                category: need.category,
                offer,
                status: 'offered',
                deliveryMethod: null,
                deliveryLocation: null,
            });

            this.onOfferSent(bot, bb, need.id, offer);
            return true;
        }

        return false;
    }

    /**
     * Check if we can help with this need category.
     * Uses recipe service to check if our materials could be used to craft the needed item.
     *
     * Example: If we provide ['log', 'planks', 'stick'] and need is 'hoe',
     * returns true because planks + sticks are used to craft wooden_hoe.
     */
    private canProvideForCategory(category: string): boolean {
        // Direct category match
        if (this.config.canProvideCategories.includes(category)) return true;

        // Check if our materials can help craft items in this category
        return this.recipeService.canMaterialsHelpWith(
            category,
            this.config.canProvideCategories
        );
    }

    /**
     * Initiate delivery after our offer is accepted.
     */
    private async initiateDelivery(
        bot: Bot,
        bb: TBlackboard,
        state: RespondingNeedState
    ): Promise<BehaviorStatus> {
        bb.lastAction = 'initiating_delivery';

        // Get requester position (need to look them up)
        const need = bb.villageChat!.getNeedById(state.needId);
        if (!need) {
            this.respondingNeeds.delete(state.needId);
            return 'failure';
        }

        // Find requester entity to get their position
        const requester = Object.values(bot.entities).find(
            e => e.username === need.from
        );
        const requesterPos = requester?.position ?? bb.villageChat!.getVillageCenter() ?? bot.entity.position;

        // Choose delivery method
        const method = bb.villageChat!.chooseDeliveryMethod(requesterPos);
        state.deliveryMethod = method;

        if (method === 'chest') {
            const chest = bb.villageChat!.getSharedChest();
            if (chest) {
                state.deliveryLocation = chest;
                bb.villageChat!.announceProvideAt(state.needId, 'chest', chest);
                state.status = 'delivering';
                return 'running';
            }
        }

        // Fall back to trade
        state.deliveryMethod = 'trade';
        const meetingPoint = bb.villageChat!.getTradeMeetingPoint(bot.entity.position);
        state.deliveryLocation = meetingPoint;
        bb.villageChat!.announceProvideAt(state.needId, 'trade', meetingPoint);
        state.status = 'delivering';

        return 'running';
    }

    /**
     * Perform the actual delivery - walk to location and drop items.
     */
    private async performDelivery(
        bot: Bot,
        bb: TBlackboard,
        state: RespondingNeedState
    ): Promise<BehaviorStatus> {
        if (!state.deliveryLocation) {
            return 'failure';
        }

        const location = state.deliveryLocation;
        const distanceToLocation = bot.entity.position.distanceTo(location);

        // Walk to delivery location if not already there
        if (distanceToLocation > 3) {
            bb.log?.info(
                { needId: state.needId, location: `(${location.x}, ${location.y}, ${location.z})`, distance: distanceToLocation.toFixed(1) },
                `[${this.config.roleLabel}] Walking to delivery location`
            );

            try {
                await smartPathfinderGoto(bot, new GoalNear(location.x, location.y, location.z, 2));
            } catch (error) {
                bb.log?.warn(
                    { err: error, location: `(${location.x}, ${location.y}, ${location.z})` },
                    `[${this.config.roleLabel}] Failed to reach delivery location`
                );
                return 'running'; // Keep trying
            }
        }

        // Drop the items for the requester
        for (const itemStack of state.offer.items) {
            const item = bot.inventory.items().find(i => i.name === itemStack.name);
            if (item) {
                const dropCount = Math.min(item.count, itemStack.count);
                try {
                    await bot.toss(item.type, item.metadata, dropCount);
                    bb.log?.info(
                        { item: itemStack.name, count: dropCount },
                        `[${this.config.roleLabel}] Dropped items for delivery`
                    );
                } catch (error) {
                    bb.log?.warn(
                        { err: error, item: itemStack.name },
                        `[${this.config.roleLabel}] Failed to drop item`
                    );
                    return 'failure';
                }
            } else {
                bb.log?.warn(
                    { item: itemStack.name },
                    `[${this.config.roleLabel}] Item not found in inventory for delivery`
                );
            }
        }

        bb.log?.info(
            { needId: state.needId },
            `[${this.config.roleLabel}] Delivery complete`
        );

        return 'success';
    }

    /**
     * Mark a need as delivered (called by external delivery action).
     */
    markDelivered(needId: string): void {
        const state = this.respondingNeeds.get(needId);
        if (state) {
            state.status = 'delivered';
        }
    }

    /**
     * Get the delivery info for a need we're responding to.
     */
    getDeliveryInfo(needId: string): {
        method: DeliveryMethod;
        location: Vec3;
        items: ItemStack[];
    } | null {
        const state = this.respondingNeeds.get(needId);
        if (!state || !state.deliveryMethod || !state.deliveryLocation) {
            return null;
        }
        return {
            method: state.deliveryMethod,
            location: state.deliveryLocation,
            items: state.offer.items,
        };
    }

    /**
     * Get all needs we're currently responding to.
     */
    getRespondingNeeds(): string[] {
        return Array.from(this.respondingNeeds.keys());
    }

    /**
     * Check if we're responding to a specific need.
     */
    isRespondingTo(needId: string): boolean {
        return this.respondingNeeds.has(needId);
    }

    /**
     * Get the status of a need we're responding to.
     */
    getRespondingStatus(needId: string): RespondingNeedState['status'] | null {
        return this.respondingNeeds.get(needId)?.status ?? null;
    }

    /**
     * Clean up stale responding needs.
     */
    cleanupStaleNeeds(maxAgeMs: number = 300000): void {
        // This would need timestamps - for now just clear delivered ones
        for (const [needId, state] of this.respondingNeeds) {
            if (state.status === 'delivered') {
                this.respondingNeeds.delete(needId);
            }
        }
    }
}
