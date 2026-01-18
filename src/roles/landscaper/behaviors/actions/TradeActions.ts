import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import {
    BaseBroadcastOffer,
    BaseRespondToOffer,
    BaseCompleteTrade,
} from '../../../../shared/actions';

/**
 * BroadcastOffer - Offer unwanted items for trade.
 *
 * Landscaper-specific: Offers items that aren't dirt, cobble, tools, or planks.
 */
export class BroadcastOffer extends BaseBroadcastOffer<LandscaperBlackboard> {
    constructor() {
        super({
            role: 'landscaper',
            roleLabel: 'Landscaper',
            minTradeableItems: 4,
            offerCooldown: 30000,
        });
    }
}

/**
 * RespondToOffer - Respond to trade offers for items we want.
 *
 * Landscaper-specific: Responds to offers for dirt, cobble, tools, etc.
 */
export class RespondToOffer extends BaseRespondToOffer<LandscaperBlackboard> {
    constructor() {
        super({
            role: 'landscaper',
            roleLabel: 'Landscaper',
        });
    }
}

/**
 * CompleteTrade - Execute an active trade (travel, exchange, done).
 *
 * Handles the full trade flow once a trade is accepted.
 */
export class CompleteTrade extends BaseCompleteTrade<LandscaperBlackboard> {
    constructor() {
        super({
            role: 'landscaper',
            roleLabel: 'Landscaper',
        });
    }
}
