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
        const totalSeeds = inventory
            .filter(i => i.name.includes('seeds') || ['carrot', 'potato', 'beetroot'].includes(i.name))
            .reduce((sum, item) => sum + item.count, 0);

        if (!hoe || totalSeeds === 0) return null;

        // 2. Resolve Farm Anchor (Prospecting)
        let farmAnchor = role.getNearestPOI(bot, 'farm_center')?.position;
        let waterBlock = farmAnchor ? bot.blockAt(farmAnchor) : null;

        // A. Validate existing anchor
        if (farmAnchor) {
            // Check if it's still water
            if (!waterBlock || (waterBlock.name !== 'water' && waterBlock.name !== 'flowing_water')) {
                role.log(`Abandoning farm center at ${farmAnchor} - No longer water.`);
                role.forgetPOI('farm_center', farmAnchor);
                farmAnchor = undefined;
                waterBlock = null;
            } 
            else {
                // Check if it's productive (has tillable land)
                // If we have active farmland nearby, we keep it. If not, and it has no potential, dump it.
                const hasActiveFarm = this.hasNeighboringFarmland(bot, farmAnchor, 5);
                const potential = this.countTillableNeighbors(bot, farmAnchor, role);

                if (!hasActiveFarm && potential < 3) {
                    role.log(`Abandoning farm center at ${farmAnchor} - Poor soil conditions (${potential} tillable).`);
                    role.forgetPOI('farm_center', farmAnchor);
                    farmAnchor = undefined;
                    waterBlock = null;
                }
            }
        }

        // B. Find NEW Anchor if needed
        if (!farmAnchor) {
            // Scan for multiple candidates
            const waterCandidates = bot.findBlocks({
                matching: (b) => b.name === 'water' || b.name === 'flowing_water',
                maxDistance: 64, // Good range
                count: 16
            });

            let bestPos: Vec3 | null = null;
            let bestScore = -1;

            for (const pos of waterCandidates) {
                // Score based on tillable neighbors
                const tillableCount = this.countTillableNeighbors(bot, pos, role);
                
                if (tillableCount > bestScore) {
                    bestScore = tillableCount;
                    bestPos = pos;
                }
            }

            // Require at least 3 valid blocks to accept a spot
            if (bestPos && bestScore >= 3) {
                role.log(`Found suitable farm location at ${bestPos} (Capacity: ~${bestScore} blocks).`);
                role.rememberPOI('farm_center', bestPos);
                farmAnchor = bestPos;
                waterBlock = bot.blockAt(bestPos);
            }
        }

        // If still no anchor, we fail (this triggers exploration in LogisticsTask/Idle)
        if (!farmAnchor || !waterBlock) {
             return null;
        }

        // 3. Limit Check (Don't till if we have enough spots for seeds)
        // Check active farmland count around anchor
        const unplantedFarmland = bot.findBlocks({
            point: farmAnchor,
            maxDistance: 10,
            matching: (b) => {
                if (b.name !== 'farmland') return false;
                // Only count unplanted ones
                const above = bot.blockAt(b.position.offset(0, 1, 0));
                return !!(above && (above.name === 'air' || above.name === 'cave_air'));
            },
            count: 100
        });

        if (unplantedFarmland.length >= totalSeeds) {
            return null;
        }

        // 4. Find Actual Tilling Target
        const candidates: { block: any, score: number }[] = [];
        const waterPos = waterBlock.position;

        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                // STRICT: Same Y level as water
                const pos = waterPos.offset(x, 0, z);
                if (pos.equals(waterPos)) continue;
                if (role.failedBlocks.has(pos.toString())) continue;

                const block = bot.blockAt(pos);
                if (!block) continue;

                // Must be dirt/grass
                if (block.name !== 'grass_block' && block.name !== 'dirt') continue;

                // Must have open space above (air or breakable plants)
                if (!this.isClearAbove(bot, pos)) continue;

                let score = 100;
                // Prefer closer to water
                score -= pos.distanceTo(waterPos);
                // Prefer adjacent to existing farmland (clumping)
                if (this.hasNeighboringFarmland(bot, pos, 1)) score += 50;

                candidates.push({ block, score });
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            return {
                priority: 15,
                description: `Tilling ground at ${candidates[0].block.position}`,
                target: candidates[0].block,
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
            
            // Clean block above if it's grass/fern
            const abovePos = target.position.offset(0, 1, 0);
            const above = bot.blockAt(abovePos);
            if (above && above.boundingBox !== 'empty' && above.name !== 'air') {
                await bot.dig(above);
            }

            await bot.lookAt(target.position.offset(0.5, 1, 0.5), true);
            await bot.activateBlock(target);
            await new Promise(r => setTimeout(r, 250));

            const updated = bot.blockAt(target.position);
            if (updated && updated.name !== 'farmland') {
                 role.log(`❌ Tilling failed. Blacklisting.`);
                 role.blacklistBlock(target.position);
            }
        } catch (err) {
            role.blacklistBlock(target.position);
        }
    }

    private isClearAbove(bot: Bot, pos: Vec3): boolean {
        const above = bot.blockAt(pos.offset(0, 1, 0));
        if (!above) return false;
        // Allow air, cave_air, and common ground plants
        const allowed = ['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'poppy', 'dandelion', 'snow'];
        return allowed.includes(above.name) || above.name.includes('flower');
    }

    private countTillableNeighbors(bot: Bot, center: Vec3, role: FarmingRole): number {
        let count = 0;
        // Scan 9x9 area around center (radius 4)
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                const pos = center.offset(x, 0, z);
                if (pos.equals(center)) continue;
                if (role.failedBlocks.has(pos.toString())) continue;
                
                const block = bot.blockAt(pos);
                if (block && (block.name === 'grass_block' || block.name === 'dirt') && this.isClearAbove(bot, pos)) {
                    count++;
                }
            }
        }
        return count;
    }

    private hasNeighboringFarmland(bot: Bot, pos: Vec3, radius: number): boolean {
        const r = Math.ceil(radius);
        for(let x = -r; x <= r; x++) {
            for(let z = -r; z <= r; z++) {
                if (x===0 && z===0) continue;
                const b = bot.blockAt(pos.offset(x, 0, z));
                if (b && b.name === 'farmland') return true;
            }
        }
        return false;
    }
}