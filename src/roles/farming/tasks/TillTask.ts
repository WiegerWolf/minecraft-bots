// ./src/roles/farming/tasks/TillTask.ts
import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class TillTask implements Task {
    name = 'till';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // 1. Inventory Check
        const inventory = bot.inventory.items();
        const hoe = inventory.find(i => i.name.includes('hoe'));
        
        const seedNames = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
        const totalSeeds = inventory
            .filter(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name))
            .reduce((sum, item) => sum + item.count, 0);

        if (!hoe || totalSeeds === 0) return null;

        // 2. Find water (The true anchor of a farm)
        // We prioritize finding water first, because that dictates where the farm IS.
        
        let farmAnchor = role.getNearestPOI(bot, 'farm_center')?.position;
        let water: any = null;

        // A. If we have a center, look for water there
        if (farmAnchor) {
            water = bot.findBlock({
                point: farmAnchor,
                maxDistance: 10, // Must be very close to center
                matching: b => !!b && (b.name === 'water' || b.name === 'flowing_water')
            });
        }

        // B. If no center or no water at center, search wide for new water
        if (!water) {
             water = bot.findBlock({
                point: bot.entity.position,
                maxDistance: 64, 
                matching: b => !!b && (b.name === 'water' || b.name === 'flowing_water')
            });

            if (water) {
                // Found new water! Establish this as the farm center.
                // This stops the drifting.
                farmAnchor = water.position;
                role.rememberPOI('farm_center', water.position);
                role.log(`⚓ Established farm center at water source: ${water.position}`);
            }
        }

        if (!water || !farmAnchor) {
             if (Math.random() < 0.01) role.log("⚠️ Have seeds, but no water found anywhere nearby.");
             return null;
        }

        // 3. Check existing unplanted farmland around the ANCHOR
        const unplantedFarmland = bot.findBlocks({
            point: farmAnchor,
            maxDistance: 20,
            matching: (b) => {
                if (!b || !b.position || !b.name) return false;
                if (b.name !== 'farmland') return false;
                const above = bot.blockAt(b.position.offset(0, 1, 0));
                return !!(above && (above.name === 'air' || above.name === 'cave_air'));
            },
            count: 200 // Check enough blocks
        });

        // STRICT LIMIT: Don't till if we already have enough spots for our seeds
        if (unplantedFarmland.length >= totalSeeds) {
            return null; 
        }

        // 4. Find valid dirt/grass to till around the WATER
        const candidates: { block: any, score: number }[] = [];
        const waterPos = water.position;
        
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                // Strictly same Y-level as water
                const pos = waterPos.offset(x, 0, z);
                
                if (pos.equals(waterPos)) continue;
                if (role.failedBlocks.has(pos.toString())) continue;

                const block = bot.blockAt(pos);
                if (!block || !block.name || (block.name !== 'grass_block' && block.name !== 'dirt')) continue;

                const above = bot.blockAt(pos.offset(0, 1, 0));
                if (!above || !above.name || (above.name !== 'air' && above.name !== 'cave_air' && !above.name.includes('grass') && !above.name.includes('fern'))) continue;

                let score = 0;
                // Prefer being close to the water (center)
                const distToCenter = pos.distanceTo(waterPos);
                score -= distToCenter * 2; 

                // Bonus for extending existing fields
                if (this.hasNeighboringFarmland(bot, pos)) score += 50;

                candidates.push({ block, score });
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            
            if (!best) return null;

            return {
                priority: 15,
                description: `Tilling ground at ${best.block.position}`,
                target: best.block,
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return;

        try {
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
            
            bot.pathfinder.stop();
            bot.pathfinder.setGoal(null);
            await bot.equip(hoe, 'hand');

            await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
            await bot.activateBlock(target);
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
            const updatedBlock = bot.blockAt(target.position);
            if (updatedBlock && updatedBlock.name === 'farmland') {
                // DO NOT update farm_center here. Keep it at the water source.
            } else {
                role.log(`❌ Tilling failed. Blacklisting.`);
                role.blacklistBlock(target.position);
            }
        } catch (err) {
            role.blacklistBlock(target.position);
        }
    }

    private hasNeighboringFarmland(bot: Bot, pos: Vec3): boolean {
        const neighbors = [
            pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
            pos.offset(0, 0, 1), pos.offset(0, 0, -1)
        ];
        return neighbors.some(p => bot.blockAt(p)?.name === 'farmland');
    }
}