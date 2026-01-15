import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export type Constructor<T = {}> = new (...args: any[]) => T;

export function ResourceMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        // Track recent locations to avoid backtracking
        private visitedChunks: { x: number, z: number, time: number }[] = [];
        private readonly HISTORY_SIZE = 20;
        
        // Helper to log from this mixin
        protected logResource(msg: string) {
            console.log(`[Resource] ${msg}`);
        }

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
            this.logResource("Calculating exploration path...");
            
            // 1. Record current location in history
            const currentPos = bot.entity.position;
            this.visitedChunks.push({ x: currentPos.x, z: currentPos.z, time: Date.now() });
            
            // Keep history buffer small
            if (this.visitedChunks.length > this.HISTORY_SIZE) {
                this.visitedChunks.shift(); // Remove oldest
            }

            // 2. Generate candidates in a circle around the bot
            const candidates: { pos: Vec3, score: number }[] = [];
            const directions = 12; // Check 12 angles (every 30 degrees)
            const dist = 32;       // Distance to travel

            for (let i = 0; i < directions; i++) {
                const angle = (Math.PI * 2 * i) / directions;
                const tx = currentPos.x + Math.cos(angle) * dist;
                const tz = currentPos.z + Math.sin(angle) * dist;
                
                // 3. Verify it's valid land (not water)
                const surfaceBlock = this.findSurfaceBlock(bot, Math.floor(tx), Math.floor(tz));

                if (surfaceBlock) {
                    if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water' || surfaceBlock.name === 'kelp') {
                        continue; 
                    }
                    
                    // 4. Calculate Novelty Score
                    // Score = Distance to the nearest visited point (Maximize this)
                    let minDistanceToHistory = 9999;
                    for (const visit of this.visitedChunks) {
                        const d = Math.hypot(tx - visit.x, tz - visit.z);
                        if (d < minDistanceToHistory) minDistanceToHistory = d;
                    }

                    // Add small randomness to prevent perfect straight lines if history is empty
                    const score = minDistanceToHistory + (Math.random() * 5);

                    candidates.push({ 
                        pos: surfaceBlock.position.offset(0, 1, 0), 
                        score 
                    });
                }
            }

            // 5. Select the best candidate (furthest from history)
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            
            if (best) {
                this.logResource(`Exploration target found (Score: ${best.score.toFixed(1)}). Moving to ${best.pos.floored()}`);
                try {
                    await bot.pathfinder.goto(new GoalNear(best.pos.x, best.pos.y, best.pos.z, 2));
                    return true;
                } catch (e) {
                    this.logResource("Exploration movement failed (pathfinding).");
                    return false;
                }
            } else {
                this.logResource("No good exploration targets found (surrounded by water?). Staying put.");
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