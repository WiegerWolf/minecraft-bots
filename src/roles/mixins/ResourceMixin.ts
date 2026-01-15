import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export type Constructor<T = {}> = new (...args: any[]) => T;

export function ResourceMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        
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
                    if (!blockNames.includes(block.name)) return false;
                    
                    // Filter out blacklisted blocks
                    if (failedBlocks && failedBlocks.has(block.position.toString())) return false;
                    
                    return true;
                },
                maxDistance: maxDistance,
                count: count
            });

            if (found.length === 0) return null;

            // FIX: Handle noUncheckedIndexedAccess by checking existence or asserting
            const pos = found[0];
            if (!pos) return null;

            return bot.blockAt(pos);
        }

        /**
         * Finds a safe spot to wander to that is NOT water.
         */
        public async wanderNewChunk(bot: Bot) {
            this.logResource("Searching for new land to explore...");
            
            // Try 10 random angles to find dry land
            for (let i = 0; i < 10; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 20 + Math.random() * 20; // 20-40 blocks away
                
                const targetX = bot.entity.position.x + Math.cos(angle) * dist;
                const targetZ = bot.entity.position.z + Math.sin(angle) * dist;
                
                // Get the height at that position
                const surfaceBlock = this.findSurfaceBlock(bot, Math.floor(targetX), Math.floor(targetZ));

                if (surfaceBlock) {
                    // Check if it's water
                    if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water' || surfaceBlock.name === 'kelp') {
                        continue; // Skip water
                    }
                    
                    // We found land!
                    this.logResource(`Found land at ${surfaceBlock.position}. Moving there.`);
                    try {
                        await bot.pathfinder.goto(new GoalNear(surfaceBlock.position.x, surfaceBlock.position.y + 1, surfaceBlock.position.z, 2));
                        return true;
                    } catch (e) {
                        // Move failed, try next attempt
                    }
                }
            }
            
            this.logResource("Could not find obvious land nearby. Staying put.");
            return false;
        }

        private findSurfaceBlock(bot: Bot, x: number, z: number) {
            // Scan up from bottom of world or a fixed reasonable range
            // For efficiency, scan down from bot's Y + 10 to bot's Y - 20
            const startY = Math.min(Math.floor(bot.entity.position.y) + 10, 319);
            const endY = Math.max(Math.floor(bot.entity.position.y) - 20, -60);

            for (let y = startY; y >= endY; y--) {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (block && block.boundingBox === 'block' && block.name !== 'leaves') { 
                    // Found solid ground (or water, which counts as a block for this check, filtered later)
                    return block;
                }
                if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                    return block; // Return water so we can detect it and skip
                }
            }
            return null;
        }
    };
}