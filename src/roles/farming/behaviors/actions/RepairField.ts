import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { sleep } from './utils';

const { GoalNear, GoalLookAtBlock } = goals;

/**
 * Repairs holes in the farm field by finding dirt elsewhere and placing it.
 * Detects missing blocks in the 9x9 area around farm center.
 */
export class RepairField implements BehaviorNode {
    name = 'RepairField';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        if (!bb.farmCenter) return 'failure';

        // Find holes in the farm (air blocks where farmland should be)
        const hole = this.findHoleInFarm(bot, bb.farmCenter);
        if (!hole) return 'failure';

        // Check if we have dirt in inventory
        const dirtItem = bot.inventory.items().find(i => i.name === 'dirt');

        if (dirtItem) {
            // We have dirt - place it in the hole
            return await this.placeDirt(bot, bb, hole, dirtItem);
        } else {
            // Need to get dirt from elsewhere
            return await this.gatherDirt(bot, bb);
        }
    }

    private findHoleInFarm(bot: Bot, farmCenter: Vec3): Vec3 | null {
        // Check 9x9 area around farm center (excluding the water block itself)
        for (let x = -4; x <= 4; x++) {
            for (let z = -4; z <= 4; z++) {
                // Skip the water center
                if (x === 0 && z === 0) continue;

                const pos = farmCenter.offset(x, 0, z);
                const block = bot.blockAt(pos);

                // A hole is where we expect farmland but find air or water
                if (!block || block.name === 'air' || block.name === 'cave_air') {
                    // Verify there's a solid block below (not a natural pit)
                    const below = bot.blockAt(pos.offset(0, -1, 0));
                    if (below && !['air', 'cave_air', 'water', 'lava'].includes(below.name)) {
                        console.log(`[BT] Found hole in farm at ${pos}`);
                        return pos;
                    }
                }
            }
        }
        return null;
    }

    private async placeDirt(bot: Bot, bb: FarmingBlackboard, hole: Vec3, dirtItem: any): Promise<BehaviorStatus> {
        console.log(`[BT] Repairing farm - placing dirt at ${hole}`);
        bb.lastAction = 'repair';

        try {
            // Move near the hole
            await bot.pathfinder.goto(new GoalNear(hole.x, hole.y, hole.z, 3));
            bot.pathfinder.stop();

            // Find a block to place against (below the hole)
            const below = bot.blockAt(hole.offset(0, -1, 0));
            if (!below) return 'failure';

            // Equip dirt and place it
            await bot.equip(dirtItem, 'hand');
            await bot.lookAt(hole.offset(0.5, 0.5, 0.5), true);
            await bot.placeBlock(below, new Vec3(0, 1, 0));
            await sleep(200);

            console.log(`[BT] Successfully repaired hole at ${hole}`);
            return 'success';
        } catch (err) {
            console.log(`[BT] Failed to place dirt: ${err}`);
            return 'failure';
        }
    }

    private async gatherDirt(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Find dirt/grass blocks OUTSIDE the farm area
        const farmCenter = bb.farmCenter!;
        const botPos = bot.entity.position;

        // Search around bot position for better results
        const dirtBlocks = bot.findBlocks({
            point: botPos,
            maxDistance: 48,
            count: 50,
            matching: (block) => {
                if (!block) return false;
                return block.name === 'dirt' || block.name === 'grass_block';
            }
        });

        // Filter to blocks outside farm area and with accessible top
        let insideFarm = 0;
        let noAccessible = 0;
        for (const pos of dirtBlocks) {
            // Must be outside the farm area (more than 5 blocks from center in X or Z)
            const dx = Math.abs(pos.x - farmCenter.x);
            const dz = Math.abs(pos.z - farmCenter.z);
            if (dx <= 5 && dz <= 5) {
                insideFarm++;
                continue;
            }

            // Must have air or short plants above (accessible)
            const above = bot.blockAt(pos.offset(0, 1, 0));
            if (!above) {
                noAccessible++;
                continue;
            }
            const accessibleAbove = ['air', 'short_grass', 'tall_grass', 'grass', 'fern'].includes(above.name);
            if (!accessibleAbove) {
                noAccessible++;
                continue;
            }

            const block = bot.blockAt(pos);
            if (!block) continue;

            console.log(`[BT] Gathering dirt from ${pos} to repair farm`);
            bb.lastAction = 'gather_dirt';

            try {
                await bot.pathfinder.goto(new GoalLookAtBlock(pos, bot.world));
                await bot.dig(block);
                await sleep(300);
                return 'success';
            } catch (err) {
                console.log(`[BT] Failed to gather dirt: ${err}`);
                return 'failure';
            }
        }

        console.log(`[BT] No accessible dirt found: ${dirtBlocks.length} total, ${insideFarm} inside farm, ${noAccessible} not accessible`);
        return 'failure';
    }
}
