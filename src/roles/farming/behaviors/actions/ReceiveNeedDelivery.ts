import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import type { FarmingBlackboard } from '../../Blackboard';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';

const { GoalNear } = goals;

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * ReceiveNeedDelivery - Go to a delivery location and pick up items.
 *
 * This action handles the requester side of need fulfillment after a provider
 * has dropped items. It:
 * 1. Navigates to the delivery location
 * 2. Collects nearby dropped items
 * 3. Marks the need as fulfilled (from requester's perspective)
 *
 * This fixes the coordination bug where providers would mark needs fulfilled
 * before the requester actually picked up the items.
 */
export class ReceiveNeedDelivery {
  readonly name = 'ReceiveNeedDelivery';
  private deliveryTimeout = 60000; // 60 seconds to pick up items
  private startTime: number = 0;
  private hasNavigated: boolean = false;
  private pickupAttempts: number = 0;
  private maxPickupAttempts: number = 10;

  async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
    // Check if we have a pending delivery
    if (!bb.pendingDelivery) {
      bb.log?.debug('No pending delivery to receive');
      this.reset();
      return 'failure';
    }

    const { needId, location, method, items } = bb.pendingDelivery;

    // Initialize timing on first tick
    if (this.startTime === 0) {
      this.startTime = Date.now();
      bb.log?.info(
        { needId, location: location.toString(), method, items: items.map(i => `${i.count}x ${i.name}`).join(', ') },
        'Starting to receive need delivery'
      );
    }

    // Check for timeout
    if (Date.now() - this.startTime > this.deliveryTimeout) {
      bb.log?.warn({ needId, elapsed: Date.now() - this.startTime }, 'Delivery pickup timed out');
      // Mark need as expired since we couldn't pick up in time
      bb.villageChat?.markNeedExpired(needId);
      bb.pendingDelivery = null;
      this.reset();
      return 'failure';
    }

    const distance = bot.entity.position.distanceTo(location);
    bb.lastAction = `receiving_delivery_${Math.floor(distance)}m`;

    // Navigate to delivery location if not close enough
    if (distance > 3 && !this.hasNavigated) {
      bb.log?.debug({ needId, distance: distance.toFixed(1) }, 'Navigating to delivery location');

      try {
        await smartPathfinderGoto(bot, new GoalNear(location.x, location.y, location.z, 2));
        this.hasNavigated = true;
        bb.log?.debug({ needId }, 'Arrived at delivery location');
      } catch (error) {
        bb.log?.warn({ err: error, needId }, 'Failed to reach delivery location');
        return 'running'; // Keep trying
      }
    }

    // Look for drops at the delivery location
    const nearbyDrops = Object.values(bot.entities).filter(e => {
      if (e.name !== 'item' || !e.position) return false;
      return e.position.distanceTo(location) < 5;
    });

    if (nearbyDrops.length > 0) {
      bb.log?.debug({ needId, drops: nearbyDrops.length }, 'Found drops at delivery location');

      // Move toward and collect each drop
      for (const drop of nearbyDrops) {
        try {
          // Walk directly into the item to pick it up
          const dropPos = drop.position;
          if (bot.entity.position.distanceTo(dropPos) > 1) {
            await smartPathfinderGoto(bot, new GoalNear(dropPos.x, dropPos.y, dropPos.z, 0.5));
          }
          // Wait a moment for pickup
          await new Promise(r => setTimeout(r, 200));
        } catch (error) {
          bb.log?.debug({ err: error }, 'Error collecting drop');
        }
      }

      // Check if we received any of the expected items
      const receivedItems = this.checkReceivedItems(bot, items);
      if (receivedItems.length > 0) {
        bb.log?.info(
          { needId, received: receivedItems.map(i => `${i.count}x ${i.name}`).join(', ') },
          'Successfully received delivery items'
        );

        // Mark the need as fulfilled FROM THE REQUESTER SIDE
        bb.villageChat?.markNeedFulfilled(needId);
        bb.pendingDelivery = null;
        this.reset();
        return 'success';
      }
    }

    this.pickupAttempts++;
    if (this.pickupAttempts >= this.maxPickupAttempts) {
      bb.log?.warn({ needId, attempts: this.pickupAttempts }, 'Max pickup attempts reached');
      // Don't mark as expired - items might still be there
      // Just reset and let the goal re-evaluate
      this.reset();
      return 'failure';
    }

    // Keep waiting for items to appear
    bb.log?.debug({ needId, attempts: this.pickupAttempts }, 'Waiting for delivery items');
    return 'running';
  }

  /**
   * Check which of the expected items we received.
   */
  private checkReceivedItems(
    bot: Bot,
    expectedItems: Array<{ name: string; count: number }>
  ): Array<{ name: string; count: number }> {
    const received: Array<{ name: string; count: number }> = [];

    for (const expected of expectedItems) {
      // Match exact name or partial (e.g., 'oak_planks' matches 'oak')
      const prefix = expected.name.split('_')[0] ?? expected.name;
      const count = bot.inventory.items()
        .filter(i => i.name === expected.name || i.name.includes(prefix))
        .reduce((sum, i) => sum + i.count, 0);

      if (count > 0) {
        received.push({ name: expected.name, count });
      }
    }

    return received;
  }

  private reset(): void {
    this.startTime = 0;
    this.hasNavigated = false;
    this.pickupAttempts = 0;
  }
}
