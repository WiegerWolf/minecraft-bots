import type { FarmingBlackboard } from '../../Blackboard';
import { BasePickupItems } from '../../../../shared/actions';

/**
 * PickupItems - Collect dropped items for the farmer role.
 *
 * Farmer-specific configuration:
 * - MAX_ATTEMPTS: 3 (fewer attempts before giving up)
 * - Walks to exact position (goalRadius: 0)
 * - No close-distance waiting (closeDistanceThreshold: 0)
 * - Waits 500ms after reaching item
 */
export class PickupItems extends BasePickupItems<FarmingBlackboard> {
    constructor() {
        super({
            maxAttempts: 3,
            closeDistanceThreshold: 0, // Walk to exact position
            closeDistanceWaitMs: 500,
            goalRadius: 0,
            roleLabel: 'Farmer',
            lastActionMoving: 'pickup',
            lastActionWaiting: 'pickup',
        });
    }
}
