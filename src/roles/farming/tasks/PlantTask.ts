import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { Vec3 } from 'vec3';

export class PlantTask implements Task {
    name = 'plant';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // 1. Do we have any seeds?
        const inventory = bot.inventory.items();
        const hasSeeds = inventory.some(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        if (!hasSeeds) return null;

        // 2. Find empty farmland
        const farmAnchor = role.getNearestPOI(bot, 'farm_center');
        const point = farmAnchor ? farmAnchor.position : bot.entity.position;

        const farmland = bot.findBlock({
            point,
            maxDistance: 32,
            matching: (b) => {
                if (b.name !== 'farmland') return false;
                if (role.failedBlocks.has(b.position.toString())) return false;
                
                // Check if block above is air
                const above = bot.blockAt(b.position.offset(0, 1, 0));
                return !!(above && (above.name === 'air' || above.name === 'cave_air'));
            }
        });

        if (farmland) {
            return {
                priority: 8, // Slightly lower than harvest
                description: `Planting on farmland at ${farmland.position}`,
                target: farmland,
                range: 3.5,
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const cropName = this.getOptimalCrop(bot, target.position);
        if (!cropName) {
            role.log("Failed to determine optimal crop or no seeds.");
            return;
        }

        const seedItem = bot.inventory.items().find(i => i.name === cropName);
        if (!seedItem) return;

        await bot.equip(seedItem, 'hand');
        
        // Place on top of the farmland
        try {
            await bot.placeBlock(target, new Vec3(0, 1, 0));
            role.log(`Planted ${cropName}`);
            
            // Update farm center memory
            role.rememberPOI('farm_center', target.position);
        } catch (err) {
            role.blacklistBlock(target.position);
        }
    }

    private getOptimalCrop(bot: Bot, position: Vec3): string | null {
        const inventory = bot.inventory.items();
        
        // Get available seed types
        const availableSeeds = inventory.filter(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        if (availableSeeds.length === 0) return null;

        // Simple logic: Don't plant what is already next to it (Monoculture avoidance / Striping)
        // Or simplified: Just pick the first seed found.
        return availableSeeds[0].name;
    }
}