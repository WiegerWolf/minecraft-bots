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

        if (!hasHoe || !hasSeeds) return null;

        // 2. Find water to expand around
        // Optimization: Start from Farm Center if it exists, otherwise Bot
        const farmAnchor = role.getNearestPOI(bot, 'farm_center');
        const point = farmAnchor ? farmAnchor.position : bot.entity.position;

        const water = bot.findBlock({
            point,
            maxDistance: 32,
            matching: b => b.name === 'water'
        });

        if (!water) return null;

        // 3. Find a tillable block near that water
        // We look for grass/dirt that is NOT farmland yet, but within 4 blocks of water
        const candidates: { block: any, score: number }[] = [];
        
        // Scan a small area around the found water
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                for (let y = -1; y <= 1; y++) {
                    const pos = water.position.offset(x, y, z);
                    const block = bot.blockAt(pos);

                    if (block && (block.name === 'grass_block' || block.name === 'dirt')) {
                        // Must have air above
                        const above = bot.blockAt(pos.offset(0, 1, 0));
                        if (above && (above.name === 'air' || above.name === 'cave_air')) {
                            
                            // Check if valid (not blacklisted)
                            if (role.failedBlocks.has(pos.toString())) continue;

                            // Simple scoring: Prefer blocks next to existing farmland
                            let score = 10;
                            if (this.hasNeighboringFarmland(bot, pos)) score += 20;
                            
                            candidates.push({ block, score });
                        }
                    }
                }
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];
            
            // Add null check
            if (!best) return null;

            return {
                priority: 5, // Lower priority than harvesting/planting
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
            await bot.activateBlock(target);
            // Update farm center since we just expanded the farm
            role.rememberPOI('farm_center', target.position);
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