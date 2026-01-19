import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import { goals } from 'mineflayer-pathfinder';

/**
 * FollowLumberjack - Follow the lumberjack during exploration phase.
 *
 * When there's no village center established, the farmer should loosely follow
 * the lumberjack to stay within VillageChat range and hear about the village
 * center location when it's established.
 *
 * The bot maintains a comfortable distance (15-30 blocks) - close enough to
 * hear village chat but not so close as to be underfoot.
 */
export class FollowLumberjack {
    name = 'FollowLumberjack';

    private maxFollowDistance = 30;   // Start following if further than this
    private targetDistance = 20;       // Try to get within this distance
    private minDistance = 15;          // Don't get closer than this
    private lastPathTime = 0;
    private pathCooldown = 2000;       // Don't repath more often than every 2s
    private hasAnnounced = false;      // Track if we've announced following

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<'success' | 'failure' | 'running'> {
        // Check if we have a lumberjack to follow
        if (!bb.lumberjackPosition || !bb.lumberjackName) {
            bb.log?.debug('No lumberjack visible to follow');
            return 'failure';
        }

        // If village center is established, no need to follow
        if (bb.villageCenter) {
            bb.log?.debug('Village center established, no need to follow lumberjack');
            return 'success';
        }

        const pos = bot.entity.position;
        const distance = pos.distanceTo(bb.lumberjackPosition);

        // Already close enough
        if (distance <= this.targetDistance) {
            bb.log?.debug({ distance: distance.toFixed(1) }, 'Close enough to lumberjack');
            bb.lastAction = 'following_lumberjack';
            return 'success';
        }

        // Don't repath too often
        const now = Date.now();
        if (now - this.lastPathTime < this.pathCooldown) {
            return 'running';
        }
        this.lastPathTime = now;

        // Announce following start
        if (!this.hasAnnounced) {
            bot.chat(`Following ${bb.lumberjackName} during exploration`);
            this.hasAnnounced = true;
        }

        bb.log?.info({
            lumberjack: bb.lumberjackName,
            distance: distance.toFixed(1),
            target: this.targetDistance
        }, 'Following lumberjack');

        try {
            // Stop any current movement
            bot.pathfinder.stop();

            // Move toward the lumberjack, but stay at target distance
            // Calculate a position that's targetDistance blocks away from the lumberjack
            const direction = pos.minus(bb.lumberjackPosition).normalize();
            const targetPos = bb.lumberjackPosition.plus(direction.scaled(this.targetDistance));

            // Use GoalNear with a range so we stop when we're in the comfort zone
            const goal = new goals.GoalNear(
                targetPos.x,
                targetPos.y,
                targetPos.z,
                5  // Allow some slack
            );

            await bot.pathfinder.goto(goal);

            bb.lastAction = 'followed_lumberjack';
            bb.consecutiveIdleTicks = 0;

            return 'success';
        } catch (error) {
            bb.log?.warn({ error }, 'Failed to follow lumberjack');
            return 'failure';
        }
    }
}
