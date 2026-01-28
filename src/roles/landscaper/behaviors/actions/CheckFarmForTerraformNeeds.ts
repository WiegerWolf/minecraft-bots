import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { GoalNear } from 'baritone-ts';

/**
 * CheckFarmForTerraformNeeds - Visit a known farm and check if terraforming is needed.
 *
 * This enables proactive terraforming: the landscaper discovers farms from signs
 * and periodically checks them, creating terraform requests as needed.
 */
export class CheckFarmForTerraformNeeds implements BehaviorNode {
    name = 'CheckFarmForTerraformNeeds';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // No farms to check
        if (bb.farmsNeedingCheck.length === 0) {
            return 'failure';
        }

        // Get the first farm to check
        const farmPos = bb.farmsNeedingCheck[0]!;
        const farmKey = `${Math.floor(farmPos.x)},${Math.floor(farmPos.y)},${Math.floor(farmPos.z)}`;

        bb.log?.debug({ pos: farmPos.floored().toString() }, 'Checking farm for terraform needs');

        // Move close to the farm to scan it
        const distToFarm = bot.entity.position.distanceTo(farmPos);
        if (distToFarm > 20) {
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(farmPos.x, farmPos.y, farmPos.z, 10),
                { timeoutMs: 30000 }
            );
            if (!result.success) {
                bb.log?.warn({ pos: farmPos.floored().toString() }, 'Failed to reach farm for checking');
                // Mark as checked to avoid retrying immediately
                bb.lastFarmCheckTimes.set(farmKey, Date.now());
                bb.farmsNeedingCheck.shift();
                return 'failure';
            }
        }

        // Check if terraforming is needed
        const needsWork = this.needsTerraforming(bot, farmPos);

        // Mark as checked
        bb.lastFarmCheckTimes.set(farmKey, Date.now());
        bb.farmsNeedingCheck.shift();

        if (needsWork) {
            // Check if there's already a pending request for this farm
            if (bb.villageChat) {
                const allRequests = bb.villageChat.getAllTerraformRequests?.() || [];
                const hasPendingRequest = allRequests.some(req =>
                    req.position.distanceTo(farmPos) < 5 &&
                    (req.status === 'pending' || req.status === 'claimed')
                );

                if (hasPendingRequest) {
                    bb.log?.debug({ pos: farmPos.floored().toString() }, 'Farm already has pending terraform request');
                    return 'success';
                }

                // Create a terraform request
                bb.log?.info({ pos: farmPos.floored().toString() }, 'Farm needs terraforming, creating request');
                bb.villageChat.requestTerraform(farmPos);
            }
        } else {
            bb.log?.debug({ pos: farmPos.floored().toString() }, 'Farm terrain is acceptable');
        }

        return 'success';
    }

    /**
     * Check terrain quality around a farm center position.
     * Returns true if the terrain needs terraforming to be farmable.
     *
     * This is similar to the farmer's needsTerraforming check.
     */
    private needsTerraforming(bot: Bot, center: Vec3): boolean {
        const radius = 4; // Check hydration range (9x9 area)
        const targetY = Math.floor(center.y);

        let badBlocks = 0;
        let totalChecked = 0;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = Math.floor(center.x) + dx;
                const z = Math.floor(center.z) + dz;

                // Check surface level
                const surfacePos = new Vec3(x, targetY, z);
                const surfaceBlock = bot.blockAt(surfacePos);
                if (!surfaceBlock) continue;

                // Skip water (center and any existing water is fine)
                if (surfaceBlock.name === 'water' || surfaceBlock.name === 'flowing_water') continue;

                totalChecked++;

                // Check for obstacles above target level
                const aboveBlock = bot.blockAt(surfacePos.offset(0, 1, 0));
                if (aboveBlock && aboveBlock.name !== 'air' &&
                    !aboveBlock.name.includes('grass') && !aboveBlock.name.includes('fern') &&
                    !aboveBlock.name.includes('flower') && !aboveBlock.name.includes('wheat') &&
                    !aboveBlock.name.includes('carrot') && !aboveBlock.name.includes('potato') &&
                    !aboveBlock.name.includes('beetroot')) {
                    badBlocks++;
                }

                // Check for non-farmable surface
                if (!['grass_block', 'dirt', 'farmland', 'air'].includes(surfaceBlock.name)) {
                    badBlocks++;
                }
            }
        }

        // If more than 30% of the area needs work, request terraform
        if (totalChecked === 0) return false;
        const badRatio = badBlocks / totalChecked;
        return badRatio > 0.3;
    }
}
