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

        // Use findBlocks (plural) to get a list
        const farmlandBlocks = bot.findBlocks({
            point: farmAnchor,
            maxDistance: 32,
            count: 16,
            matching: (b) => {
                if (!b || !b.position || !b.name) return false;
                if (b.name !== 'farmland') return false;
                if (role.failedBlocks.has(b.position.toString())) return false;
                return true;
            }
        });

        // Filter valid planting spots (air or plants above)
        const validSpots = farmlandBlocks.filter(pos => {
            const above = bot.blockAt(pos.offset(0, 1, 0));
            if (!above) return false;
            // Relaxed check: Allow air, cave_air, or breakable plants/snow
            const isClear = ['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'snow'].includes(above.name) || above.name.includes('flower');
            return isClear;
        });

        if (validSpots.length > 0) {
            // Sort by distance to bot
            validSpots.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
            const targetPos = validSpots[0]; // Closest valid spot

            // FIX: Explicit undefined check
            if (targetPos) {
                const targetBlock = bot.blockAt(targetPos);

                if (targetBlock) {
                    return {
                        priority: 50, // CRITICAL: Higher than Scavenging (35)
                        description: `Planting on farmland at ${targetPos}`,
                        target: targetBlock,
                        task: this
                    };
                }
            }
        } else {
            if (hasSeeds && farmlandBlocks.length > 0) {
                role.log(`[PlantTask] Found ${farmlandBlocks.length} farmland blocks, but 0 valid spots.`);
            }
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const cropName = this.getOptimalCrop(bot, target.position);
        if (!cropName) {
            role.log("Abort planting: No seeds found in inventory.");
            return;
        }

        const seedItem = bot.inventory.items().find(i => i.name === cropName);
        if (!seedItem) return;

        try {
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
            bot.pathfinder.stop();
            bot.pathfinder.setGoal(null);

            // Clean block above if needed (grass/snow)
            const abovePos = target.position.offset(0, 1, 0);
            const above = bot.blockAt(abovePos);
            if (above && above.boundingBox !== 'empty' && above.name !== 'air') {
                await bot.dig(above);
            }

            await bot.equip(seedItem, 'hand');
            await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);

            // Place on top (0, 1, 0)
            await bot.placeBlock(target, new Vec3(0, 1, 0));

            role.log(`Planted ${cropName}`);
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