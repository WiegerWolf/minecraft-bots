// ./src/roles/farming/tasks/TillTask.ts
import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { Vec3 } from 'vec3';

export class TillTask implements Task {
    name = 'till';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // 1. Requirements: Must have seeds and a hoe
        const inventory = bot.inventory.items();
        const hasHoe = inventory.some(i => i.name.includes('hoe'));
        const hasSeeds = inventory.some(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name));

        if (!hasHoe) return null;

        // Log reasoning if we have a hoe but are idle
        if (!hasSeeds) {
             // We don't return a proposal, but we let the user know why we aren't tilling
             // This lets LogisticsTask take over to find seeds
             return null;
        }

        // 2. Find water to expand around
        const farmAnchor = role.getNearestPOI(bot, 'farm_center');
        const point = farmAnchor ? farmAnchor.position : bot.entity.position;

        const water = bot.findBlock({
            point,
            maxDistance: 32,
            matching: b => !!b && (b.name === 'water' || b.name === 'flowing_water')
        });

        if (!water) {
             if (Math.random() < 0.05) role.log("⚠️ Have hoe and seeds, but no water found near farm center.");
             return null;
        }

        // 3. Find a tillable block near that water
        const candidates: { block: any, score: number }[] = [];
        
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                for (let y = -1; y <= 1; y++) {
                    const pos = water.position.offset(x, y, z);
                    const block = bot.blockAt(pos);

                    if (block && (block.name === 'grass_block' || block.name === 'dirt')) {
                        const above = bot.blockAt(pos.offset(0, 1, 0));
                        if (above && (above.name === 'air' || above.name === 'cave_air')) {
                            
                            if (role.failedBlocks.has(pos.toString())) continue;

                            let score = 10;
                            // Prioritize blocks next to existing farmland
                            if (this.hasNeighboringFarmland(bot, pos)) score += 20;
                            // Prioritize blocks closer to the water
                            const dist = pos.distanceTo(water.position);
                            score -= dist;

                            candidates.push({ block, score });
                        }
                    }
                }
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            
            if (!best) return null;

            return {
                priority: 5,
                description: `Tilling ground at ${best.block.position}`,
                target: best.block,
                range: 3.5,
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
        if (!hoe) return;

        await bot.equip(hoe, 'hand');
        
        try {
            role.log(`Tilling ${target.position}...`);
            await bot.lookAt(target.position.offset(0.5, 1, 0.5));
            await bot.activateBlock(target);
            
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for server update
            const updatedBlock = bot.blockAt(target.position);
            
            if (updatedBlock && updatedBlock.name === 'farmland') {
                role.rememberPOI('farm_center', target.position);
            } else {
                role.log(`❌ Tilling failed (Lag? Protected?). Blacklisting.`);
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