import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';
import { shouldPreemptForTrade } from '../../../../shared/TradePreemption';

const { GoalNear } = goals;

// Cooldown for unreachable grass - 2 minutes
const UNREACHABLE_GRASS_COOLDOWN = 2 * 60 * 1000;

export class GatherSeeds implements BehaviorNode {
    name = 'GatherSeeds';
    private lastMaterialRequestTime = 0;
    private MATERIAL_REQUEST_COOLDOWN = 30000; // 30 seconds

    // Track unreachable grass positions (position key -> expiry timestamp)
    private unreachableGrass: Map<string, number> = new Map();

    private posKey(pos: { x: number; y: number; z: number }): string {
        return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    }

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.needsSeeds) return 'failure';

        // Clean up expired unreachable entries
        const now = Date.now();
        for (const [key, expiry] of this.unreachableGrass) {
            if (now >= expiry) {
                this.unreachableGrass.delete(key);
            }
        }

        // While gathering seeds, also broadcast need for hoe if we need tools
        // Use intent-based system: broadcast 'hoe' so lumberjack can respond with
        // a hoe, planks+sticks, or logs (whatever is most efficient)
        if (bb.needsTools && bb.villageChat) {
            const hasEnoughForHoe = (
                (bb.stickCount >= 2 && bb.plankCount >= 2) ||
                bb.logCount >= 2
            );
            if (!hasEnoughForHoe) {
                if (now - this.lastMaterialRequestTime > this.MATERIAL_REQUEST_COOLDOWN) {
                    if (!bb.villageChat.hasPendingNeedFor('hoe')) {
                        bb.log?.debug('[Farmer] Broadcasting need for hoe');
                        bb.villageChat.broadcastNeed('hoe');
                        this.lastMaterialRequestTime = now;
                    }
                }
            }
        }

        // Get candidate grass blocks from blackboard, filtering out unreachable ones
        let grassCandidates: Block[] = bb.nearbyGrass.filter(g =>
            !this.unreachableGrass.has(this.posKey(g.position))
        );

        // If no grass from blackboard, try to find some directly
        if (grassCandidates.length === 0) {
            // Try finding grass with expanded block names for different MC versions
            // Note: seagrass and tall_seagrass are excluded because they don't drop seeds
            const grassNames = [
                'short_grass', 'tall_grass', 'grass', 'fern', 'large_fern'
            ];

            const grassBlocks = bot.findBlocks({
                point: bot.entity.position,
                maxDistance: 64,
                count: 20, // Get more candidates to find clusters
                matching: b => {
                    if (!b || !b.name) return false;
                    return grassNames.includes(b.name);
                }
            });

            grassCandidates = grassBlocks
                .filter(p => !this.unreachableGrass.has(this.posKey(p)))
                .map(p => bot.blockAt(p))
                .filter((b): b is Block => b !== null);
        }

        if (grassCandidates.length === 0) {
            bb.log?.debug(`[BT] No reachable grass found nearby for seeds`);
            return 'failure';
        }

        // Find the best cluster of grass to harvest (most grass within reach distance)
        const clusterRadius = 4; // Break all grass within 4 blocks
        let bestCluster: Block[] = [];
        let bestClusterCenter: Block | null = null;

        for (const grass of grassCandidates) {
            const nearbyGrass = grassCandidates.filter(g =>
                g.position.distanceTo(grass.position) <= clusterRadius
            );
            if (nearbyGrass.length > bestCluster.length) {
                bestCluster = nearbyGrass;
                bestClusterCenter = grass;
            }
        }

        if (!bestClusterCenter) {
            bb.log?.debug(`[BT] No reachable grass found nearby for seeds`);
            return 'failure';
        }

        const dist = bot.entity.position.distanceTo(bestClusterCenter.position);
        bb.log?.debug(`[BT] Found grass cluster of ${bestCluster.length} at ${bestClusterCenter.position.floored()} (dist: ${dist.toFixed(1)})`);
        bb.lastAction = 'gather_seeds';

        try {
            // Only pathfind if not already close
            if (dist > 3) {
                const timeout = Math.min(20000, 10000 + dist * 200);

                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(bestClusterCenter.position.x, bestClusterCenter.position.y, bestClusterCenter.position.z, 2),
                    {
                        timeoutMs: timeout,
                        knightMoveRecovery: dist > 5,
                    }
                );

                if (!result.success) {
                    bb.log?.debug(`[BT] Failed to reach grass cluster at ${bestClusterCenter.position.floored()}: ${result.failureReason}`);
                    // Mark center as unreachable and return
                    this.unreachableGrass.set(this.posKey(bestClusterCenter.position), now + UNREACHABLE_GRASS_COOLDOWN);
                    return 'failure';
                }

                // Check for preemption after pathfinding
                if (shouldPreemptForTrade(bb, 'farmer')) {
                    bb.log?.debug('GatherSeeds preempted for trade after pathfinding');
                    return 'failure';
                }
            }

            // Now break all grass blocks in the cluster that are within reach
            let brokenCount = 0;
            for (const grass of bestCluster) {
                // Check for preemption - higher priority goal needs attention
                if (shouldPreemptForTrade(bb, 'farmer')) {
                    bb.log?.debug({ brokenCount }, 'GatherSeeds preempted for trade');
                    return brokenCount > 0 ? 'success' : 'failure';
                }
                const grassDist = bot.entity.position.distanceTo(grass.position);
                if (grassDist > 4.5) continue; // Too far to reach without moving

                // Check if grass still exists (might have been broken already)
                const currentBlock = bot.blockAt(grass.position);
                if (!currentBlock || !currentBlock.name.includes('grass') && currentBlock.name !== 'fern' && !currentBlock.name.includes('fern')) {
                    continue;
                }

                try {
                    await bot.dig(currentBlock);
                    brokenCount++;
                    await sleep(100); // Short delay between breaks
                } catch (digErr) {
                    bb.log?.debug(`[BT] Failed to break grass at ${grass.position.floored()}: ${digErr}`);
                }
            }

            if (brokenCount > 0) {
                bb.log?.debug(`[BT] Broke ${brokenCount} grass blocks`);
                await sleep(200); // Brief pause to let items drop
                return 'success';
            }

            // Couldn't break any grass
            this.unreachableGrass.set(this.posKey(bestClusterCenter.position), now + UNREACHABLE_GRASS_COOLDOWN);
            return 'failure';
        } catch (err) {
            bb.log?.debug(`[BT] Error gathering seeds: ${err}`);
            this.unreachableGrass.set(this.posKey(bestClusterCenter.position), now + UNREACHABLE_GRASS_COOLDOWN);
            return 'failure';
        }
    }
}
