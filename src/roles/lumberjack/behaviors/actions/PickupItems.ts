import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import { BasePickupItems } from '../../../../shared/actions';

/**
 * PickupItems - Collect dropped logs, saplings, and other items for the lumberjack role.
 *
 * Lumberjack-specific configuration:
 * - MAX_ATTEMPTS: 5 (more attempts for items that might be in awkward spots)
 * - Waits for auto-pickup when close (closeDistanceThreshold: 1.5)
 * - Uses goalRadius: 1 for pathfinding
 */
export class PickupItems extends BasePickupItems<LumberjackBlackboard> {
    constructor() {
        super({
            maxAttempts: 5,
            closeDistanceThreshold: 1.5,
            closeDistanceWaitMs: 300,
            goalRadius: 1,
            roleLabel: 'Lumberjack',
            lastActionMoving: 'pickup_moving',
            lastActionWaiting: 'pickup_waiting',
        });
    }
}
