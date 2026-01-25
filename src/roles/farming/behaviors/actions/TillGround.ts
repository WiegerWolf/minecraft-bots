import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';
import { shouldPreemptForTrade } from '../../../../shared/TradePreemption';

const { GoalNear } = goals;

// Track unreachable positions temporarily (cleared after 5 minutes)
const unreachableTillPositions = new Map<string, number>();
const UNREACHABLE_COOLDOWN_MS = 5 * 60 * 1000;

function posKey(pos: Vec3): string {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function isUnreachable(pos: Vec3): boolean {
    const key = posKey(pos);
    const markedTime = unreachableTillPositions.get(key);
    if (!markedTime) return false;
    if (Date.now() - markedTime > UNREACHABLE_COOLDOWN_MS) {
        unreachableTillPositions.delete(key);
        return false;
    }
    return true;
}

function markUnreachable(pos: Vec3): void {
    unreachableTillPositions.set(posKey(pos), Date.now());
}

export class TillGround implements BehaviorNode {
    name = 'TillGround';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.canTill) return 'failure';
        if (!bb.farmCenter) return 'failure';

        // Find all tillable blocks near water
        // IMPORTANT: In Minecraft, water ONLY hydrates farmland at the SAME Y level
        // Farmland at Y+1 above water will NOT be hydrated!
        // Only search at Y=0 (same level as water)
        const candidates: Vec3[] = [];

        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                // Skip the water block itself
                if (x === 0 && z === 0) continue;

                const pos = bb.farmCenter.offset(x, 0, z);  // Y=0 only - same level as water

                // Skip positions marked as unreachable
                if (isUnreachable(pos)) continue;

                const block = bot.blockAt(pos);
                if (block && ['grass_block', 'dirt'].includes(block.name)) {
                    const above = bot.blockAt(pos.offset(0, 1, 0));
                    if (above && above.name === 'air') {
                        candidates.push(pos.clone());
                    }
                }
            }
        }

        if (candidates.length === 0) {
            bb.log?.debug({ farmCenter: bb.farmCenter?.toString() }, 'No tillable blocks found near farm center');
            return 'failure';
        }

        // Sort by distance to bot (closest first)
        const botPos = bot.entity.position;
        candidates.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return 'failure';

        bb.lastAction = 'till';
        await bot.equip(hoe, 'hand');

        // Find the best cluster to till (most tillable blocks within reach)
        const clusterRadius = 4;
        let bestCluster: Vec3[] = [];
        let bestClusterCenter: Vec3 | null = null;

        for (const pos of candidates) {
            const nearby = candidates.filter(c => c.distanceTo(pos) <= clusterRadius);
            if (nearby.length > bestCluster.length) {
                bestCluster = nearby;
                bestClusterCenter = pos;
            }
        }

        if (!bestClusterCenter) {
            bb.log?.debug('No tillable cluster found');
            return 'failure';
        }

        bb.log?.debug({ pos: bestClusterCenter.toString(), count: bestCluster.length }, 'Found tillable cluster');

        // Move to cluster if needed
        const distToCluster = bot.entity.position.distanceTo(bestClusterCenter);
        if (distToCluster > 4) {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(bestClusterCenter.x, bestClusterCenter.y, bestClusterCenter.z, 3),
                { timeoutMs: 15000 }
            );
            if (!result.success) {
                bb.log?.debug({ reason: result.failureReason }, 'Cannot reach till cluster');
                markUnreachable(bestClusterCenter);
                return 'failure';
            }
            bot.pathfinder.stop();

            // Check for preemption after pathfinding (which can take a while)
            if (shouldPreemptForTrade(bb, 'farmer')) {
                bb.log?.debug('TillGround preempted for trade after pathfinding');
                return 'failure';
            }
        }

        // Till all reachable blocks in the cluster
        let tilledCount = 0;
        for (const targetPos of bestCluster) {
            // Check for preemption - higher priority goal needs attention
            if (shouldPreemptForTrade(bb, 'farmer')) {
                bb.log?.debug({ tilledCount }, 'TillGround preempted for trade');
                return tilledCount > 0 ? 'success' : 'failure';
            }

            const dist = bot.entity.position.distanceTo(targetPos);
            if (dist > 4.5) continue; // Too far to reach

            try {
                const block = bot.blockAt(targetPos);
                if (!block || !['grass_block', 'dirt'].includes(block.name)) continue;

                await bot.lookAt(targetPos.offset(0.5, 1, 0.5), true);
                await bot.activateBlock(block);
                await sleep(100);

                const afterBlock = bot.blockAt(targetPos);
                if (afterBlock?.name === 'farmland') {
                    tilledCount++;
                }
            } catch {
                // Continue to next position
            }
        }

        if (tilledCount > 0) {
            bb.log?.debug({ count: tilledCount }, 'Tilled ground blocks');
            return 'success';
        }

        // All positions failed
        markUnreachable(bestClusterCenter);
        return 'failure';
    }
}
