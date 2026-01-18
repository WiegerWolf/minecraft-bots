import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { readAllSignsNear, SIGN_SEARCH_RADIUS } from '../../../../shared/SignKnowledge';
import { smartPathfinderGoto } from '../../../../shared/PathfindingUtils';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

/**
 * StudySpawnSigns - Read knowledge signs near spawn to learn about farms.
 *
 * This allows the landscaper to proactively discover farm locations
 * and check them for terraforming needs.
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // Already studied signs
        if (bb.hasStudiedSigns) {
            return 'success';
        }

        // Need spawn position
        if (!bb.spawnPosition) {
            bb.spawnPosition = bot.entity.position.clone();
        }

        const spawnPos = bb.spawnPosition;

        // Move to spawn area if too far
        const distToSpawn = bot.entity.position.distanceTo(spawnPos);
        if (distToSpawn > SIGN_SEARCH_RADIUS) {
            bb.log?.debug({ dist: Math.round(distToSpawn) }, 'Moving to spawn to read signs');
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(spawnPos.x, spawnPos.y, spawnPos.z, SIGN_SEARCH_RADIUS - 5),
                { timeoutMs: 30000 }
            );
            if (!result.success) {
                bb.log?.warn('Failed to reach spawn area for sign reading');
                // Mark as studied anyway to prevent infinite retry
                bb.hasStudiedSigns = true;
                return 'failure';
            }
        }

        // Read all signs near spawn
        bb.log?.debug({ pos: spawnPos.floored().toString() }, 'Studying signs near spawn');
        const entries = readAllSignsNear(bot, spawnPos, SIGN_SEARCH_RADIUS, bb.log);

        // Process each entry
        let farmsFound = 0;
        for (const entry of entries) {
            switch (entry.type) {
                case 'FARM':
                    // Add to known farms if not already known
                    const farmExists = bb.knownFarms.some(f => f.distanceTo(entry.pos) < 10);
                    if (!farmExists) {
                        bb.knownFarms.push(entry.pos.clone());
                        farmsFound++;
                        bb.log?.info(
                            { pos: entry.pos.floored().toString() },
                            'Learned farm location from sign'
                        );
                    }
                    break;

                case 'VILLAGE':
                    if (!bb.villageCenter) {
                        bb.villageCenter = entry.pos.clone();
                        // Also update VillageChat so it persists across blackboard updates
                        bb.villageChat?.setVillageCenter?.(entry.pos.clone());
                        bb.log?.debug({ pos: entry.pos.floored().toString() }, 'Learned village center from sign');
                    }
                    break;

                case 'CHEST':
                    if (!bb.sharedChest) {
                        bb.sharedChest = entry.pos.clone();
                        // Also update VillageChat so it persists across blackboard updates
                        bb.villageChat?.setSharedChest?.(entry.pos.clone());
                        bb.log?.debug({ pos: entry.pos.floored().toString() }, 'Learned chest location from sign');
                    }
                    break;

                case 'CRAFT':
                    if (!bb.sharedCraftingTable) {
                        bb.sharedCraftingTable = entry.pos.clone();
                        // Also update VillageChat so it persists across blackboard updates
                        bb.villageChat?.setSharedCraftingTable?.(entry.pos.clone());
                        bb.log?.debug({ pos: entry.pos.floored().toString() }, 'Learned crafting table from sign');
                    }
                    break;
            }
        }

        bb.hasStudiedSigns = true;
        bb.log?.info(
            { farmsFound, totalSigns: entries.length },
            'Finished studying spawn signs'
        );

        return 'success';
    }
}
