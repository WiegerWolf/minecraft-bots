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
        
        // Count total seeds available
        const seedNames = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato'];
        const totalSeeds = inventory
            .filter(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name))
            .reduce((sum, item) => sum + item.count, 0);

        if (!hoe || totalSeeds === 0) return null;

        // 2. Check if we have enough unplanted farmland already
        // This prevents tilling the whole world with just 1 seed.
        const farmAnchor = role.getNearestPOI(bot, 'farm_center')?.position || bot.entity.position;

        const unplantedFarmland = bot.findBlocks({
            point: farmAnchor,
            maxDistance: 20, // Check immediate farm area
            matching: (b) => {
                if (b.name !== 'farmland') return false;
                const above = bot.blockAt(b.position.offset(0, 1, 0));
                return !!(above && (above.name === 'air' || above.name === 'cave_air'));
            },
            count: 100
        });

        // RULE: Don't till more than we can plant
        if (unplantedFarmland.length >= totalSeeds) {
            return null; // Let PlantTask take over
        }

        // 3. Find water to expand around (Strictly near Anchor)
        const water = bot.findBlock({
            point: farmAnchor,
            maxDistance: 20, // Keep it tight to the farm center
            matching: b => !!b && (b.name === 'water' || b.name === 'flowing_water')
        });

        if (!water) {
             // Only warn occasionally
             if (Math.random() < 0.01) role.log("⚠️ Have seeds, but no water found near farm center.");
             return null;
        }

        // 4. Find valid dirt/grass to till
        const candidates: { block: any, score: number }[] = [];
        const waterPos = water.position;
        
        // Scan specifically around the water source
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                for (let y = -1; y <= 1; y++) {
                    const pos = waterPos.offset(x, y, z);
                    
                    // Skip if blacklisted
                    if (role.failedBlocks.has(pos.toString())) continue;

                    const block = bot.blockAt(pos);
                    if (!block || (block.name !== 'grass_block' && block.name !== 'dirt')) continue;

                    const above = bot.blockAt(pos.offset(0, 1, 0));
                    if (!above || (above.name !== 'air' && above.name !== 'cave_air' && !above.name.includes('grass'))) continue;

                    let score = 0;
                    
                    // Heavy weight: Closeness to Farm Center
                    const distToCenter = pos.distanceTo(farmAnchor);
                    score -= distToCenter * 2; 

                    // Bonus: Next to existing farmland (Continuous Patch)
                    if (this.hasNeighboringFarmland(bot, pos)) score += 50;

                    candidates.push({ block, score });
                }
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            
            return {
                priority: 15, // Lower than PlantTask (20) but higher than Idle
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
            // FIX: Move close enough to touch it
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
            
            // Stop and Equip
            bot.pathfinder.stop();
            bot.pathfinder.setGoal(null);
            await bot.equip(hoe, 'hand');

            // Look and Activate
            await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
            await bot.activateBlock(target);
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
            const updatedBlock = bot.blockAt(target.position);
            if (updatedBlock && updatedBlock.name === 'farmland') {
                role.rememberPOI('farm_center', target.position);
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