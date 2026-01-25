/**
 * Trade Preemption Utilities
 *
 * Provides functions for checking if actions should be preempted for trading.
 * VillageChat receives trade events asynchronously via chat handlers, so actions
 * can check directly for trade opportunities even while blocking the GOAP tick.
 */

import type { VillageChat } from './VillageChat';
import { isWantedByRole, type RoleName } from './ItemCategories';

/**
 * Blackboard interface for preemption support.
 * Actions should check this interface to see if preemption is needed.
 */
export interface PreemptibleBlackboard {
    preemptionRequested?: boolean;
    villageChat?: VillageChat | null;
}

/**
 * Check if there's an urgent trade that should preempt the current action.
 *
 * This directly checks VillageChat which receives events asynchronously,
 * allowing actions to respond to trade offers even while they block the GOAP tick.
 *
 * @param bb - Blackboard with preemptionRequested and villageChat fields
 * @param role - The role name ('farmer', 'lumberjack', 'landscaper')
 * @returns true if the action should abort for a trade opportunity
 */
export function shouldPreemptForTrade(bb: PreemptibleBlackboard, role: RoleName): boolean {
    // Check the explicit preemption flag (set by GOAP when a high-priority goal is detected)
    if (bb.preemptionRequested) return true;

    // Check VillageChat directly for trade opportunities
    if (!bb.villageChat) return false;

    // Check for offers of items we want
    const hasWantedOffer = bb.villageChat.getActiveOffers().some((o: any) =>
        isWantedByRole(o.item, role)
    );

    // Check if we're in an active trade that needs attention
    const inTrade = bb.villageChat.isInTrade();

    return hasWantedOffer || inTrade;
}
