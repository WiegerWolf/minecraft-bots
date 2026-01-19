import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import { BasePickupItems } from '../../../../shared/actions';

/**
 * PickupItems - Collect dropped items (dirt, cobblestone, etc.) for the landscaper role.
 *
 * Landscaper-specific configuration:
 * - MAX_ATTEMPTS: 5 (more attempts for items that might be in awkward spots)
 * - goalRadius: 2 (Minecraft's auto-pickup range is ~2 blocks)
 * - closeDistanceThreshold: 2.5 (if within 2.5 blocks, wait for auto-pickup)
 * - Waits 400ms after getting close for auto-pickup
 */
export class PickupItems extends BasePickupItems<LandscaperBlackboard> {
    constructor() {
        super({
            maxAttempts: 5,
            closeDistanceThreshold: 2.5,
            closeDistanceWaitMs: 400,
            goalRadius: 2,
            roleLabel: 'Landscaper',
            lastActionMoving: 'pickup_moving',
            lastActionWaiting: 'pickup_waiting',
        });
    }
}
