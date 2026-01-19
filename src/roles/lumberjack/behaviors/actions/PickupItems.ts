import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import { BasePickupItems } from '../../../../shared/actions';

/**
 * PickupItems - Collect dropped logs, saplings, and other items for the lumberjack role.
 *
 * Lumberjack-specific configuration:
 * - MAX_ATTEMPTS: 5 (more attempts for items that might be in awkward spots)
 * - goalRadius: 2 (Minecraft's auto-pickup range is ~2 blocks)
 * - closeDistanceThreshold: 2.5 (if within 2.5 blocks, wait for auto-pickup)
 * - Waits 400ms after getting close for auto-pickup
 *
 * Note: Items dropped from trees often land on slopes, ledges, or near leaves.
 * Using a 2-block goal radius matches Minecraft's natural pickup range and
 * reduces pathfinding failures on complex terrain.
 */
export class PickupItems extends BasePickupItems<LumberjackBlackboard> {
    constructor() {
        super({
            maxAttempts: 5,
            closeDistanceThreshold: 2.5,
            closeDistanceWaitMs: 400,
            goalRadius: 2,
            roleLabel: 'Lumberjack',
            lastActionMoving: 'pickup_moving',
            lastActionWaiting: 'pickup_waiting',
        });
    }
}
