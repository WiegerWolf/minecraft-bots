import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import {
    BaseBroadcastOffer,
    BaseRespondToOffer,
    BaseCompleteTrade,
} from '../../../../shared/actions';

/**
 * BroadcastOffer - Offer unwanted items for trade.
 *
 * Lumberjack-specific: Offers items that aren't logs, planks, sticks, saplings, or axes.
 */
export class BroadcastOffer extends BaseBroadcastOffer<LumberjackBlackboard> {
    constructor() {
        super({
            role: 'lumberjack',
            roleLabel: 'Lumberjack',
            minTradeableItems: 4,
            offerCooldown: 30000,
        });
    }
}

/**
 * RespondToOffer - Respond to trade offers for items we want.
 *
 * Lumberjack-specific: Responds to offers for logs, planks, saplings, etc.
 */
export class RespondToOffer extends BaseRespondToOffer<LumberjackBlackboard> {
    constructor() {
        super({
            role: 'lumberjack',
            roleLabel: 'Lumberjack',
        });
    }
}

/**
 * CompleteTrade - Execute an active trade (travel, exchange, done).
 *
 * Handles the full trade flow once a trade is accepted.
 */
export class CompleteTrade extends BaseCompleteTrade<LumberjackBlackboard> {
    constructor() {
        super({
            role: 'lumberjack',
            roleLabel: 'Lumberjack',
        });
    }
}
