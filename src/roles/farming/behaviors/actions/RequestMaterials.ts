import type { FarmingBlackboard } from '../../Blackboard';
import { BaseRequestMaterials } from '../../../../shared/actions';

/**
 * RequestMaterials - Request logs from lumberjack via chat for the farmer role.
 *
 * The farmer requests logs (not planks/sticks) because:
 * 1. Logs are what the lumberjack naturally produces
 * 2. 1 log = 4 planks, so logs are more efficient to transport
 * 3. Farmer can craft planks/sticks from logs as needed
 */
export class RequestMaterials extends BaseRequestMaterials<FarmingBlackboard> {
    constructor() {
        super({
            roleLabel: 'Farmer',
            resourceType: 'log',
            requestAmount: 2,
            logLevel: 'info',
            pendingReturnStatus: 'running',
            requestedReturnStatus: 'running',
        });
    }

    /**
     * Check if farmer has enough materials to craft a hoe:
     * Need: 2 planks (head) + 2 sticks (handle)
     * Which requires: 4 planks total (2 for sticks) = 1 log
     * Request 2 logs (= 8 planks, enough for hoe + spare)
     */
    protected hasSufficientMaterials(bb: FarmingBlackboard): boolean {
        return (
            (bb.stickCount >= 2 && bb.plankCount >= 2) ||  // Direct materials
            bb.logCount >= 2  // 2 logs = 8 planks = enough for sticks + hoe
        );
    }
}
