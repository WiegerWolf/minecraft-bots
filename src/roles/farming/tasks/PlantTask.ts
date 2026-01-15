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
                if (!b || !b.position) return false;
                if (b.name !== 'farmland') return false;
                if (role.failedBlocks.has(b.position.toString())) return false;
                
                // Check if block above is air
                const above = bot.blockAt(b.position.offset(0, 1, 0));
                return !!(above && (above.name === 'air' || above.name === 'cave_air'));
            }
        });

        if (farmland) {
            return {
                priority: 8,
                description: `Planting on farmland at ${farmland.position}`,
                target: farmland,
                range: 2.5, // FIX: Reduce range
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
        
        try {
            await bot.lookAt(target.position.offset(0.5, 1, 0.5));
            await bot.placeBlock(target, new Vec3(0, 1, 0));
            role.log(`Planted ${cropName}`);
            role.rememberPOI('farm_center', target.position);
        } catch (err) {
            role.blacklistBlock(target.position);
        }
    }

    private getOptimalCrop(bot: Bot, position: Vec3): string | null {
        const inventory = bot.inventory.items();
        const availableSeeds = inventory.filter(item => 
            item.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(item.name)
        );
        if (availableSeeds.length === 0) return null;

        return availableSeeds[0]?.name ?? null;
    }
}