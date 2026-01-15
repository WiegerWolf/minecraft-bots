import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export type Constructor<T = {}> = new (...args: any[]) => T;

export function ResourceMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        
        protected logResource(msg: string) {
            console.log(`[Resource] ${msg}`);
        }

        public findNaturalBlock(bot: Bot, blockNames: string[], options: { maxDistance?: number, count?: number } = {}) {
            const { maxDistance = 64, count = 1 } = options;
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

            // FIX: Explicitly check found[0]
            const pos = found[0];
            if (!pos) return null;

            return bot.blockAt(pos);
        }

        public async wanderNewChunk(bot: Bot) {
            this.logResource("Searching for new land to explore...");
            
            for (let i = 0; i < 10; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 20 + Math.random() * 20; 
                
                const targetX = bot.entity.position.x + Math.cos(angle) * dist;
                const targetZ = bot.entity.position.z + Math.sin(angle) * dist;
                
                const surfaceBlock = this.findSurfaceBlock(bot, Math.floor(targetX), Math.floor(targetZ));

                if (surfaceBlock) {
                    if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water' || surfaceBlock.name === 'kelp') {
                        continue; 
                    }
                    
                    this.logResource(`Found land at ${surfaceBlock.position}. Moving there.`);
                    try {
                        await bot.pathfinder.goto(new GoalNear(surfaceBlock.position.x, surfaceBlock.position.y + 1, surfaceBlock.position.z, 2));
                        return true;
                    } catch (e) {
                    }
                }
            }
            
            this.logResource("Could not find obvious land nearby. Staying put.");
            return false;
        }

        private findSurfaceBlock(bot: Bot, x: number, z: number) {
            const startY = Math.min(Math.floor(bot.entity.position.y) + 10, 319);
            const endY = Math.max(Math.floor(bot.entity.position.y) - 20, -60);

            for (let y = startY; y >= endY; y--) {
                const block = bot.blockAt(new Vec3(x, y, z));
                if (block && block.boundingBox === 'block' && block.name !== 'leaves') { 
                    return block;
                }
                if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                    return block;
                }
            }
            return null;
        }
    };
}