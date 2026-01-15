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
            // Check if it's still water
            if (!waterBlock) {
                // Block is unloaded. Do not abandon yet.
            } else if (waterBlock.name !== 'water' && waterBlock.name !== 'flowing_water') {
                role.log(`Farm center at ${farmAnchor} is ${waterBlock.name}. Finding nearby replacement...`);
                // Try to find water nearby before abandoning
                const nearbyWater = bot.findBlocks({
                    point: farmAnchor,
                    matching: (b) => b.name === 'water' || b.name === 'flowing_water',
                    maxDistance: 50,
                    count: 1
                });

                if (nearbyWater.length > 0 && nearbyWater[0]) {
                    role.rememberPOI('farm_center', nearbyWater[0]);
                    farmAnchor = nearbyWater[0];
                    waterBlock = bot.blockAt(farmAnchor);
                    role.log(`Redirected farm center to ${farmAnchor}`);
                } else {
                    role.log(`Abandoning farm center at ${farmAnchor} - No longer water and none nearby.`);
                    role.forgetPOI('farm_center', farmAnchor);
                    farmAnchor = undefined;
                    waterBlock = null;
                }
            }
            else {
                // Check if it's productive (has tillable land)
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
            const waterCandidates = bot.findBlocks({
                matching: (b) => b.name === 'water' || b.name === 'flowing_water',
                maxDistance: 64,
                count: 16
            });

            let bestPos: Vec3 | null = null;
            let bestScore = -1;

            for (const pos of waterCandidates) {
                const tillableCount = this.countTillableNeighbors(bot, pos, role);

                if (tillableCount > bestScore) {
                    bestScore = tillableCount;
                    bestPos = pos;
                }
            }

            if (bestPos && bestScore >= 3) {
                role.log(`Found suitable farm location at ${bestPos} (Capacity: ~${bestScore} blocks).`);
                role.rememberPOI('farm_center', bestPos);
                farmAnchor = bestPos;
                waterBlock = bot.blockAt(bestPos);
            }
        }

        if (!farmAnchor || !waterBlock) {
            return null;
        }

        // 3. Limit Check (Don't till if we have enough spots for seeds)
        const unplantedFarmland = bot.findBlocks({
            point: farmAnchor,
            maxDistance: 10,
            matching: (b) => {
                // FIX: Strict safety checks to prevent crash
                if (!b || !b.position || !b.name) return false;

                if (b.name !== 'farmland') return false;
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
                const pos = waterPos.offset(x, 0, z);
                if (pos.equals(waterPos)) continue;
                if (role.failedBlocks.has(pos.toString())) continue;

                const block = bot.blockAt(pos);
                if (!block) continue;

                if (block.name !== 'grass_block' && block.name !== 'dirt') continue;
                if (!this.isClearAbove(bot, pos)) continue;

                let score = 100;
                score -= pos.distanceTo(waterPos);
                if (this.hasNeighboringFarmland(bot, pos, 1)) score += 50;

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
        const allowed = ['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'poppy', 'dandelion', 'snow'];
        return allowed.includes(above.name) || above.name.includes('flower');
    }

    private countTillableNeighbors(bot: Bot, center: Vec3, role: FarmingRole): number {
        let count = 0;
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
        for (let x = -r; x <= r; x++) {
            for (let z = -r; z <= r; z++) {
                if (x === 0 && z === 0) continue;
                const b = bot.blockAt(pos.offset(x, 0, z));
                if (b && b.name === 'farmland') return true;
            }
        }
        return false;
    }
}