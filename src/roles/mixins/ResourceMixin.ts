import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto } from '../../shared/PathfindingUtils';

const { GoalNear } = goals;

export type Constructor<T = {}> = new (...args: any[]) => T;

export function ResourceMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        // Track recent locations to avoid backtracking
        private visitedChunks: { x: number, z: number, time: number }[] = [];
        private readonly HISTORY_SIZE = 20;

        /**
         * Efficiently finds natural blocks within a large radius.
         */
        public findNaturalBlock(bot: Bot, blockNames: string[], options: { maxDistance?: number, count?: number } = {}) {
            const { maxDistance = 64, count = 1 } = options;

            // Access the blacklist from the base class (FarmingRole)
            const failedBlocks = (this as any).failedBlocks as Map<string, number>;

            const found = bot.findBlocks({
                matching: (block) => {
                    if (!block || !block.name) return false;
                    if (!blockNames.includes(block.name)) return false;
                    if (block.position && failedBlocks && failedBlocks.has(block.position.toString())) return false;
                    return true;
                },
                maxDistance: maxDistance,
                count: count
            });

            if (found.length === 0) return null;

            // Strict existence check
            const pos = found[0];
            if (!pos) return null;

            return bot.blockAt(pos);
        }

        /**
         * Finds a new chunk to explore, prioritizing unvisited areas.
         */
        public async wanderNewChunk(bot: Bot) {
            // logResource("Calculating exploration path...");

            // 1. Record current location in history
            const currentPos = bot.entity.position;
            this.visitedChunks.push({ x: currentPos.x, z: currentPos.z, time: Date.now() });

            // Keep history buffer small
            if (this.visitedChunks.length > this.HISTORY_SIZE) {
                this.visitedChunks.shift(); // Remove oldest
            }

            // 2. Generate candidates in a circle around the bot
            let bestCandidate: { pos: Vec3, score: number } | null = null;

            // Try different distances to find *any* valid spot
            const distances = [32, 16, 48];

            for (const dist of distances) {
                const candidates: { pos: Vec3, score: number }[] = [];
                const directions = 8; // Reduce checks slightly for speed

                for (let i = 0; i < directions; i++) {
                    const angle = (Math.PI * 2 * i) / directions;
                    const tx = currentPos.x + Math.cos(angle) * dist;
                    const tz = currentPos.z + Math.sin(angle) * dist;

                    // 3. Verify it's valid land (not water)
                    const surfaceBlock = this.findSurfaceBlock(bot, Math.floor(tx), Math.floor(tz));

                    if (surfaceBlock) {
                        // If strict 32 distance failed, we might be on an island.
                        // Allow water if we've tried standard distances and found nothing?
                        // For now, keep preferring land.

                        if (surfaceBlock.name === 'kelp') continue;

                        // 4. Calculate Novelty Score
                        let minDistanceToHistory = 9999;
                        for (const visit of this.visitedChunks) {
                            const d = Math.hypot(tx - visit.x, tz - visit.z);
                            if (d < minDistanceToHistory) minDistanceToHistory = d;
                        }

                        // Add small randomness
                        const score = minDistanceToHistory + (Math.random() * 5);

                        // Penalize water slightly to prefer land, but don't strictly ban it if it's the only option
                        let penalty = 0;
                        if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water') {
                            penalty = 50;
                        }

                        candidates.push({
                            pos: surfaceBlock.position.offset(0, 1, 0),
                            score: score - penalty
                        });
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.score - a.score);
                    bestCandidate = candidates[0] || null;
                    if (bestCandidate && bestCandidate.score > 0) break; // Found a good one
                }
            }

            if (bestCandidate) {
                // logResource(`Exploration target found (Score: ${bestCandidate.score.toFixed(1)}). Moving to ${bestCandidate.pos.floored()}`);
                const result = await smartPathfinderGoto(
                    bot,
                    new GoalNear(bestCandidate.pos.x, bestCandidate.pos.y, bestCandidate.pos.z, 2),
                    { timeoutMs: 30000 }  // Longer timeout for exploration
                );
                if (result.success) {
                    return true;
                } else {
                    // logResource("Exploration movement failed (pathfinding).");
                    return false;
                }
            } else {
                // logResource("No good exploration targets found. Staying put.");
                return false;
            }
        }

        private findSurfaceBlock(bot: Bot, x: number, z: number) {
            // Scan vertically for surface
            const startY = Math.min(Math.floor(bot.entity.position.y) + 10, 319);
            const endY = Math.max(Math.floor(bot.entity.position.y) - 20, -60);

            for (let y = startY; y >= endY; y--) {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (block && block.boundingBox === 'block' && block.name !== 'leaves') {
                    return block;
                }
                if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                    return block; // Return water so we can detect and skip it
                }
            }
            return null;
        }
    };
}