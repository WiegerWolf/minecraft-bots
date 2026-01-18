import type { FarmingBlackboard } from '../../Blackboard';
import {
    BaseBroadcastOffer,
    BaseRespondToOffer,
    BaseCompleteTrade,
    type BehaviorStatus,
} from '../../../../shared/actions';

/**
 * BroadcastOffer - Offer unwanted items for trade.
 *
 * Farmer-specific: Offers items that aren't seeds, produce, or crafting materials.
 */
export class BroadcastOffer extends BaseBroadcastOffer<FarmingBlackboard> {
    constructor() {
        super({
            role: 'farmer',
            roleLabel: 'Farmer',
            minTradeableItems: 4,
            offerCooldown: 30000,
        });
    }
}

/**
 * RespondToOffer - Respond to trade offers for items we want.
 *
 * Farmer-specific: Responds to offers for seeds, logs, planks, etc.
 */
export class RespondToOffer extends BaseRespondToOffer<FarmingBlackboard> {
    constructor() {
        super({
            role: 'farmer',
            roleLabel: 'Farmer',
        });
    }
}

/**
 * CompleteTrade - Execute an active trade (travel, exchange, done).
 *
 * Handles the full trade flow once a trade is accepted.
 */
export class CompleteTrade extends BaseCompleteTrade<FarmingBlackboard> {
    constructor() {
        super({
            role: 'farmer',
            roleLabel: 'Farmer',
        });
    }
}
