/**
 * Intent-Based Need & Fulfillment System Types
 *
 * This system replaces the material-specific request system ([REQUEST] log 2)
 * with an intent-based need system where bots express what they're trying to
 * accomplish ([NEED] hoe), and other bots respond with what they can provide.
 */

import type { Vec3 } from 'vec3';

/**
 * Status of a need throughout its lifecycle.
 */
export type NeedStatus =
    | 'broadcasting' // Collecting offers (30s window)
    | 'accepted' // Provider selected, awaiting delivery
    | 'fulfilled' // Got what we needed
    | 'expired'; // Timed out or cancelled

/**
 * Type of offer: the item itself or materials to craft it.
 */
export type OfferType = 'item' | 'materials';

/**
 * Completeness of an offer: fully satisfies need or partial.
 */
export type OfferCompleteness = 'full' | 'partial';

/**
 * Delivery method for fulfilling a need.
 */
export type DeliveryMethod = 'chest' | 'trade';

/**
 * A single item with count.
 */
export interface ItemStack {
    name: string;
    count: number;
}

/**
 * An offer from another bot to fulfill a need.
 */
export interface NeedOffer {
    /** Bot name offering to help */
    from: string;
    /** Direct item vs crafting materials */
    type: OfferType;
    /** Whether this offer fully satisfies the need */
    completeness: OfferCompleteness;
    /** Items being offered */
    items: ItemStack[];
    /** Number of crafting steps needed (0 = ready to use) */
    craftingSteps: number;
    /** When the offer was made */
    timestamp: number;
    /** Computed score for ranking (higher is better) */
    score?: number;
}

/**
 * A need broadcast by a bot.
 */
export interface Need {
    /** Unique identifier: <botname>-<category>-<timestamp> */
    id: string;
    /** Bot that has this need */
    from: string;
    /** What is needed: "hoe", "axe", "log", etc. */
    category: string;
    /** When the need was broadcast */
    timestamp: number;
    /** Current status */
    status: NeedStatus;
    /** Offers collected during broadcast window */
    offers: NeedOffer[];
    /** Selected provider (after acceptance) */
    acceptedProvider: string | null;
    /** Delivery location if announced */
    deliveryLocation?: Vec3;
    /** Delivery method if announced */
    deliveryMethod?: DeliveryMethod;
}

/**
 * Extended need tracking for the requester side,
 * including partial fulfillment tracking.
 */
export interface ActiveNeed extends Need {
    /** Total items required to fulfill this need */
    totalRequired: ItemStack[];
    /** Items received so far (maps item name to count) */
    receivedSoFar: Map<string, number>;
    /** All providers that have been accepted (for multi-source) */
    acceptedProviders: string[];
}

/**
 * A path of materials that can produce an item.
 * Each path represents one way to get the item.
 */
export interface MaterialPath {
    /** Items needed for this path */
    items: ItemStack[];
    /** Number of crafting steps (0 = item itself) */
    craftingSteps: number;
}

/**
 * Result of checking if inventory can satisfy a need.
 */
export interface SatisfactionResult {
    /** Whether the need can be satisfied at all */
    canSatisfy: boolean;
    /** Best offer that can be made */
    bestOffer: NeedOffer | null;
    /** Percentage of need that can be satisfied (0-100) */
    completeness: number;
}

/**
 * Configuration for the offer collection window.
 */
export interface NeedConfig {
    /** How long to collect offers before selecting (ms) */
    offerWindowMs: number;
    /** How long before a need expires if not fulfilled (ms) */
    expirationMs: number;
    /** Maximum crafting depth for recipe expansion */
    maxRecipeDepth: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_NEED_CONFIG: NeedConfig = {
    offerWindowMs: 30_000, // 30 seconds
    expirationMs: 300_000, // 5 minutes
    maxRecipeDepth: 2, // Raw materials
};

/**
 * Generate a unique need ID.
 */
export function generateNeedId(botName: string, category: string): string {
    return `${botName}-${category}-${Date.now()}`;
}

/**
 * Score an offer for ranking purposes.
 * Higher score = better offer.
 */
export function scoreOffer(
    offer: NeedOffer,
    options: {
        needRemaining?: number;
        chestNearby?: boolean;
    } = {}
): number {
    const { needRemaining = 1, chestNearby = false } = options;

    let score = 0;

    // Crafting steps (lower = better): 0→150, 1→100, 2→50, 3→0
    score += Math.max(0, (3 - offer.craftingSteps) * 50);

    // Satisfaction percentage (0-100 points)
    const quantity = offer.items.reduce((sum, item) => sum + item.count, 0);
    const satisfaction = Math.min(1, quantity / needRemaining);
    score += satisfaction * 100;

    // Full vs partial bonus
    if (offer.completeness === 'full') {
        score += 20;
    }

    // Proximity bonus for chest delivery
    if (chestNearby) {
        score += 10;
    }

    return score;
}

/**
 * Rank offers by score, with timestamp as tiebreaker.
 */
export function rankOffers(offers: NeedOffer[]): NeedOffer[] {
    return [...offers].sort((a, b) => {
        const scoreA = a.score ?? scoreOffer(a);
        const scoreB = b.score ?? scoreOffer(b);
        if (scoreB !== scoreA) {
            return scoreB - scoreA; // Higher score first
        }
        return a.timestamp - b.timestamp; // Earlier timestamp wins ties
    });
}
