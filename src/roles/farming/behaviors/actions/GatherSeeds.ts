import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';

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
                count: 10, // Get multiple candidates
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

        // Try each grass candidate in order (closest first, since findBlocks sorts by distance)
        for (const grass of grassCandidates) {
            const dist = bot.entity.position.distanceTo(grass.position);
            bb.log?.debug(`[BT] Trying to reach ${grass.name} for seeds at ${grass.position.floored()} (dist: ${dist.toFixed(1)})`);
            bb.lastAction = 'gather_seeds';

            try {
                // Scale timeout with distance - 10s base + 0.2s per block
                const timeout = Math.min(20000, 10000 + dist * 200);

                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(grass.position.x, grass.position.y, grass.position.z, 2),
                    { timeoutMs: timeout }
                );

                if (!result.success) {
                    bb.log?.debug(`[BT] Failed to reach grass at ${grass.position.floored()}: ${result.failureReason}`);
                    // Mark as unreachable and try next candidate
                    this.unreachableGrass.set(this.posKey(grass.position), now + UNREACHABLE_GRASS_COOLDOWN);
                    continue;
                }

                // Successfully reached, try to dig
                await bot.dig(grass);
                await sleep(300);
                return 'success';
            } catch (err) {
                bb.log?.debug(`[BT] Error reaching grass at ${grass.position.floored()}: ${err}`);
                // Mark as unreachable and try next candidate
                this.unreachableGrass.set(this.posKey(grass.position), now + UNREACHABLE_GRASS_COOLDOWN);
                continue;
            }
        }

        // All candidates failed
        bb.log?.debug(`[BT] All ${grassCandidates.length} grass candidates were unreachable`);
        return 'failure';
    }
}
