import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BasePickupItems } from '../../../../shared/actions';

/**
 * PickupItems - Collect dropped items (dirt, cobblestone, etc.) for the landscaper role.
 *
 * Landscaper-specific configuration:
 * - MAX_ATTEMPTS: 5 (more attempts for items that might be in awkward spots)
 * - Waits for auto-pickup when close (closeDistanceThreshold: 1.5)
 * - Uses goalRadius: 1 for pathfinding
 */
export class PickupItems extends BasePickupItems<LandscaperBlackboard> {
    constructor() {
        super({
            maxAttempts: 5,
            closeDistanceThreshold: 1.5,
            closeDistanceWaitMs: 300,
            goalRadius: 1,
            roleLabel: 'Landscaper',
            lastActionMoving: 'pickup_moving',
            lastActionWaiting: 'pickup_waiting',
        });
    }
}
