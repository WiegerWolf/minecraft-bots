import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BaseRequestMaterials } from '../../../../shared/actions';

/**
 * RequestMaterials - Request logs from lumberjack via chat for the landscaper role.
 *
 * The landscaper requests logs to craft tools (shovel, pickaxe).
 * Logs are what the lumberjack naturally produces and are efficient to transport.
 */
export class RequestMaterials extends BaseRequestMaterials<LandscaperBlackboard> {
    constructor() {
        super({
            roleLabel: 'Landscaper',
            resourceType: 'log',
            requestAmount: 2,
            logLevel: 'debug',
            pendingReturnStatus: 'success', // Landscaper returns success when request pending
            requestedReturnStatus: 'success', // Landscaper returns success after making request
        });
    }

    /**
     * Check if landscaper has enough materials to craft all needed tools:
     * Shovel: 1 plank + 2 sticks = 3 planks equivalent
     * Pickaxe: 3 planks + 2 sticks = 5 planks equivalent
     * Total worst case: 8 planks = 2 logs
     */
    protected hasSufficientMaterials(bb: LandscaperBlackboard): boolean {
        const hasShovelMaterials = bb.hasShovel || bb.logCount >= 1 || bb.plankCount >= 3;
        const hasPickaxeMaterials = bb.hasPickaxe || bb.logCount >= 2 || bb.plankCount >= 5;

        // If we have materials for all needed tools, no need to request
        return (bb.hasShovel || hasShovelMaterials) && (bb.hasPickaxe || hasPickaxeMaterials);
    }
}
