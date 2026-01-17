import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { pathfinderGotoWithRetry, sleep } from './utils';
import {
    findSignsNear,
    readSignText,
    parseSignText,
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
 * This replaces the instant sign reading with a visible, roleplay-friendly behavior.
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Already studied or no spawn position
        if (bb.hasStudiedSigns || !bb.spawnPosition) {
            bb.hasStudiedSigns = true;
            return 'success';
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
            const reachedSpawn = await pathfinderGotoWithRetry(bot, spawnGoal, 2, 10000);
            if (!reachedSpawn) {
                bb.log?.warn('Could not reach spawn area to study signs');
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
        const signs = findSignsNear(bot, bb.spawnPosition, 15);

        if (signs.length === 0) {
            bb.log?.info('No knowledge signs found near spawn');
            bot.chat('No signs near spawn - starting fresh!');
            bb.hasStudiedSigns = true;
            return 'success';
        }

        bb.log?.info({ signCount: signs.length }, 'Found signs to study');

        // Visit each sign
        const learned: Array<{ type: SignKnowledgeType; pos: Vec3 }> = [];

        for (const sign of signs) {
            try {
                // Walk close to the sign
                const signGoal = new GoalNear(
                    sign.position.x,
                    sign.position.y,
                    sign.position.z,
                    2
                );
                await pathfinderGotoWithRetry(bot, signGoal, 1, 5000);

                // Look at the sign (face it)
                await bot.lookAt(sign.position.offset(0.5, 0.5, 0.5));
                await sleep(500); // Pause to "read" the sign

                // Read and parse the sign
                const lines = readSignText(sign);
                const entry = parseSignText(lines);

                if (entry) {
                    learned.push(entry);
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
        for (const entry of learned) {
            switch (entry.type) {
                case 'VILLAGE':
                    bb.villageCenter = entry.pos;
                    if (bb.villageChat) {
                        bb.villageChat.setVillageCenter(entry.pos);
                    }
                    break;
                case 'CRAFT':
                    bb.sharedCraftingTable = entry.pos;
                    if (bb.villageChat) {
                        bb.villageChat.setSharedCraftingTable(entry.pos);
                    }
                    break;
                case 'CHEST':
                    bb.sharedChest = entry.pos;
                    if (bb.villageChat) {
                        bb.villageChat.setSharedChest(entry.pos);
                    }
                    break;
            }
        }

        // Announce what was learned on village chat
        if (learned.length > 0) {
            const summaries = learned.map(e => {
                const typeName = e.type === 'VILLAGE' ? 'village center' :
                                 e.type === 'CRAFT' ? 'crafting table' : 'chest';
                return `${typeName} at (${Math.floor(e.pos.x)}, ${Math.floor(e.pos.y)}, ${Math.floor(e.pos.z)})`;
            });

            const message = `Studied ${learned.length} sign${learned.length > 1 ? 's' : ''}: ${summaries.join(', ')}`;
            bot.chat(message);
        }

        bb.log?.info({ learnedCount: learned.length }, 'Finished studying spawn signs');
        bb.hasStudiedSigns = true;
        return 'success';
    }
}
