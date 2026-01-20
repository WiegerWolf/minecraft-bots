import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';
import {
    findSignsNear,
    readSignText,
    parseSignText,
    getTypeName,
    SIGN_SEARCH_RADIUS,
    type SignKnowledgeType
} from '../../../../shared/SignKnowledge';

const { GoalNear } = goals;

/**
 * StudySpawnSigns - Walk to spawn and study knowledge signs (roleplay + learning)
 *
 * This action provides a more immersive "learning from signs" experience:
 * 1. Walk to spawn area
 * 2. Find all signs near spawn
 * 3. Walk to each sign, look at it
 * 4. Parse the sign content
 * 5. Announce what was learned on village chat
 * 6. Apply knowledge to blackboard
 *
 * Landscaper-specific: learns about FARM, VILLAGE, CHEST, CRAFT, DIRTPIT
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // Already studied or no spawn position
        if (bb.hasStudiedSigns) {
            return 'success';
        }

        // Need spawn position
        if (!bb.spawnPosition) {
            bb.spawnPosition = bot.entity.position.clone();
        }

        bb.lastAction = 'study_spawn_signs';
        bb.log?.info({ spawnPos: bb.spawnPosition.toString() }, 'Walking to spawn to study signs');

        // Walk to spawn area first
        try {
            const spawnGoal = new GoalNear(
                bb.spawnPosition.x,
                bb.spawnPosition.y,
                bb.spawnPosition.z,
                5
            );
            const result = await smartPathfinderGoto(bot, spawnGoal, { timeoutMs: 15000 });
            if (!result.success) {
                bb.log?.warn({ reason: result.failureReason }, 'Could not reach spawn area to study signs');
                // Mark as studied anyway to avoid infinite loops
                bb.hasStudiedSigns = true;
                return 'failure';
            }
        } catch (err) {
            bb.log?.warn({ err }, 'Error walking to spawn');
            bb.hasStudiedSigns = true;
            return 'failure';
        }

        // Find all signs near spawn
        const signs = findSignsNear(bot, bb.spawnPosition, SIGN_SEARCH_RADIUS);

        if (signs.length === 0) {
            bb.log?.info('No knowledge signs found near spawn');
            bot.chat('No signs near spawn - starting fresh!');
            bb.hasStudiedSigns = true;
            return 'success';
        }

        bb.log?.info({ signCount: signs.length }, 'Found signs to study');

        // Visit each sign
        const learned: Array<{ type: SignKnowledgeType; pos: Vec3; signPos: Vec3 }> = [];

        for (const sign of signs) {
            try {
                // Walk close to the sign
                const signGoal = new GoalNear(
                    sign.position.x,
                    sign.position.y,
                    sign.position.z,
                    2
                );
                await smartPathfinderGoto(bot, signGoal, { timeoutMs: 8000 });

                // Look at the sign (face it)
                await bot.lookAt(sign.position.offset(0.5, 0.5, 0.5));
                await sleep(500); // Pause to "read" the sign

                // Mark sign as read
                const signKey = `${Math.floor(sign.position.x)},${Math.floor(sign.position.y)},${Math.floor(sign.position.z)}`;
                bb.readSignPositions.add(signKey);

                // Read and parse the sign
                const lines = readSignText(sign);
                const entry = parseSignText(lines);

                if (entry) {
                    learned.push({ ...entry, signPos: sign.position.clone() });
                    bb.log?.info(
                        { type: entry.type, pos: entry.pos.toString() },
                        'Studied sign'
                    );
                }
            } catch (err) {
                bb.log?.debug({ err, signPos: sign.position.toString() }, 'Could not study sign');
                // Continue to next sign
            }
        }

        // Apply learned knowledge to blackboard
        let farmsFound = 0;
        for (const entry of learned) {
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
                        // Verify it still exists
                        const block = bot.blockAt(entry.pos);
                        if (block?.name === 'chest' || block?.name === 'barrel') {
                            bb.sharedChest = entry.pos.clone();
                            // Also update VillageChat so it persists across blackboard updates
                            bb.villageChat?.setSharedChest?.(entry.pos.clone());
                            bb.log?.debug({ pos: entry.pos.floored().toString() }, 'Learned chest location from sign');
                        }
                    }
                    break;

                case 'CRAFT':
                    if (!bb.sharedCraftingTable) {
                        // Verify it still exists
                        const block = bot.blockAt(entry.pos);
                        if (block?.name === 'crafting_table') {
                            bb.sharedCraftingTable = entry.pos.clone();
                            // Also update VillageChat so it persists across blackboard updates
                            bb.villageChat?.setSharedCraftingTable?.(entry.pos.clone());
                            bb.log?.debug({ pos: entry.pos.floored().toString() }, 'Learned crafting table from sign');
                        }
                    }
                    break;

                case 'DIRTPIT':
                    if (!bb.dirtpit) {
                        bb.dirtpit = entry.pos.clone();
                        bb.hasDirtpit = true;
                        bb.log?.info({ pos: entry.pos.floored().toString() }, 'Learned dirtpit location from sign');
                    }
                    break;

                // Other landmarks noted but not acted on
                case 'FOREST':
                case 'MINE':
                case 'WATER':
                    bb.log?.debug({ type: entry.type, pos: entry.pos.toString() }, 'Noted landmark');
                    break;
            }
        }

        // Announce what was learned on village chat
        if (learned.length > 0) {
            const summaries = learned.map(e => {
                const typeName = getTypeName(e.type);
                return `${typeName} at (${Math.floor(e.pos.x)}, ${Math.floor(e.pos.y)}, ${Math.floor(e.pos.z)})`;
            });

            const message = `Studied ${learned.length} sign${learned.length > 1 ? 's' : ''}: ${summaries.join(', ')}`;
            bot.chat(message);
        }

        bb.hasStudiedSigns = true;
        bb.log?.info(
            { farmsFound, totalSigns: learned.length },
            'Finished studying spawn signs'
        );

        return 'success';
    }
}
