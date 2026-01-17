import type { Bot } from 'mineflayer';
import {
    type FarmingBlackboard,
    hasClearSky,
} from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { GoalNear } = goals;

/**
 * Find and establish a farm center near water.
 * This action helps the bot locate a suitable farming location.
 */
export class FindFarmCenter implements BehaviorNode {
    name = 'FindFarmCenter';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Already have a farm center
        if (bb.farmCenter) return 'failure';

        // Try to find water nearby via blackboard - just needs clear sky above
        const suitableWater = bb.nearbyWater.filter(w =>
            hasClearSky(bot, w.position, 0)
        );

        if (suitableWater.length > 0) {
            const water = suitableWater[0];
            if (water) {
                bb.farmCenter = water.position.clone();
                console.log(`[BT] Established farm center at ${water.position}`);
                return 'success';
            }
        }

        // No water in perception range, search more actively
        // Search up to 128 blocks (8 chunks) - like a player scanning the horizon
        const waterBlocks = bot.findBlocks({
            point: bot.entity.position,
            maxDistance: 128,
            count: 50, // Find many candidates to filter
            matching: b => {
                if (!b || !b.name) return false;
                return b.name === 'water' || b.name === 'flowing_water';
            }
        });

        // Filter for water under clear sky (not in caves)
        // Simple check: if the water block has sky directly above, it's good
        const suitablePositions: Vec3[] = [];

        for (const pos of waterBlocks) {
            const vec = new Vec3(pos.x, pos.y, pos.z);

            // Just check if this water block has clear sky above
            if (hasClearSky(bot, vec, 0)) {
                suitablePositions.push(vec);
            }
        }

        if (suitablePositions.length > 0) {
            // Simple: just pick the closest surface water
            // Any water with clear sky works - don't be picky
            const sortedPositions = suitablePositions
                .map(pos => ({
                    pos,
                    dist: bot.entity.position.distanceTo(pos),
                }))
                .sort((a, b) => a.dist - b.dist);

            const best = sortedPositions[0];
            if (best) {
                const dist = Math.round(best.dist);
                console.log(`[BT] Found surface water at ${best.pos} (${dist} blocks away, Y=${best.pos.y}), moving to establish farm`);
                bb.lastAction = 'find_farm';

                try {
                    await bot.pathfinder.goto(new GoalNear(best.pos.x, best.pos.y, best.pos.z, 4));

                    // Set farm center directly
                    bb.farmCenter = new Vec3(best.pos.x, best.pos.y, best.pos.z);
                    console.log(`[BT] Established farm center at ${bb.farmCenter}`);

                    return 'success';
                } catch (err) {
                    console.log(`[BT] Failed to reach water at ${best.pos}: ${err}`);
                    // Don't give up - still set farm center if we're reasonably close
                    const dist = bot.entity.position.distanceTo(best.pos);
                    if (dist < 32) {
                        bb.farmCenter = new Vec3(best.pos.x, best.pos.y, best.pos.z);
                        console.log(`[BT] Set farm center anyway (${Math.round(dist)} blocks away)`);
                        return 'success';
                    }
                    return 'failure';
                }
            }
        }

        if (waterBlocks.length > 0) {
            console.log(`[BT] Found ${waterBlocks.length} water sources but none with clear sky above`);
        } else {
            console.log(`[BT] No water found within 128 blocks`);
        }
        return 'failure';
    }
}
