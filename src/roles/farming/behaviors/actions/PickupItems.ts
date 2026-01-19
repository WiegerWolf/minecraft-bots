import type { FarmingBlackboard } from '../../Blackboard';
import { BasePickupItems } from '../../../../shared/actions';

/**
 * PickupItems - Collect dropped items for the farmer role.
 *
 * Farmer-specific configuration:
 * - MAX_ATTEMPTS: 5 (give more attempts before marking unreachable)
 * - goalRadius: 2 (Minecraft's auto-pickup range is ~2 blocks)
 * - closeDistanceThreshold: 2.5 (if within 2.5 blocks, wait for auto-pickup)
 * - Waits 400ms after getting close for auto-pickup
 *
 * Previous config (goalRadius: 0, closeDistanceThreshold: 0) caused many
 * "unreachable" failures because the pathfinder struggled to reach EXACT
 * item positions on complex terrain. Items on slopes, ledges, or near
 * obstacles were marked unreachable even when easily collectable.
 */
export class PickupItems extends BasePickupItems<FarmingBlackboard> {
    constructor() {
        super({
            maxAttempts: 5,
            closeDistanceThreshold: 2.5, // Wait for auto-pickup when close
            closeDistanceWaitMs: 400,
            goalRadius: 2, // Minecraft pickup range
            roleLabel: 'Farmer',
            lastActionMoving: 'pickup',
            lastActionWaiting: 'pickup',
        });
    }
}
