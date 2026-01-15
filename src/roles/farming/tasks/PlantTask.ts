// ./src/roles/farming/tasks/PlantTask.ts
import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class PlantTask implements Task {
    name = 'plant';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // 1. Do we have any seeds?
        const inventory = bot.inventory.items();
        const hasSeeds = inventory.some(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        if (!hasSeeds) return null;

        // 2. Find empty farmland near center
        const farmAnchor = role.getNearestPOI(bot, 'farm_center')?.position || bot.entity.position;

        // Find closest unplanted farmland
        const farmland = bot.findBlock({
            point: farmAnchor,
            maxDistance: 30,
            matching: (b) => {
                // FIX: Strict Null Checks
                if (!b || !b.position || !b.name) return false;
                
                if (b.name !== 'farmland') return false;
                if (role.failedBlocks.has(b.position.toString())) return false;
                
                const above = bot.blockAt(b.position.offset(0, 1, 0));
                return !!(above && (above.name === 'air' || above.name === 'cave_air'));
            }
        });

        if (farmland) {
            return {
                priority: 20, 
                description: `Planting on farmland at ${farmland.position}`,
                target: farmland,
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const cropName = this.getOptimalCrop(bot, target.position);
        if (!cropName) return;

        const seedItem = bot.inventory.items().find(i => i.name === cropName);
        if (!seedItem) return;

        try {
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
            bot.pathfinder.stop();
            bot.pathfinder.setGoal(null);

            await bot.equip(seedItem, 'hand');
            await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
            
            // Place on top (0, 1, 0)
            await bot.placeBlock(target, new Vec3(0, 1, 0));
            
            role.log(`Planted ${cropName}`);
            role.rememberPOI('farm_center', target.position);
        } catch (err) {
            role.log(`Planting failed: ${err}`);
            role.blacklistBlock(target.position);
        }
    }

    private getOptimalCrop(bot: Bot, position: Vec3): string | null {
        const inventory = bot.inventory.items();
        const availableSeeds = inventory.filter(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        availableSeeds.sort((a, b) => b.count - a.count);
        return availableSeeds[0]?.name ?? null;
    }
}