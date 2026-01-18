import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
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
 * Farmer-specific: learns about FARM, WATER, CHEST, CRAFT, VILLAGE
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // Already studied or no spawn position
        if (bb.hasStudiedSigns || !bb.spawnPosition) {
            bb.hasStudiedSigns = true;
            return 'success';
        }

        bb.lastAction = 'study_spawn_signs';
        bb.log?.info({ spawnPos: bb.spawnPosition.toString() }, 'Walking to spawn to study signs');

        // Walk to spawn area first (with knight's move recovery)
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
                // Walk close to the sign (with knight's move recovery)
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
        for (const entry of learned) {
            switch (entry.type) {
                case 'VILLAGE':
                    // Note village center but farmer doesn't use it directly
                    bb.log?.debug({ pos: entry.pos.toString() }, 'Noted village center');
                    break;

                case 'CRAFT':
                    if (!bb.sharedCraftingTable) {
                        // Verify it still exists
                        const block = bot.blockAt(entry.pos);
                        if (block?.name === 'crafting_table') {
                            bb.sharedCraftingTable = entry.pos;
                            bb.villageChat?.setSharedCraftingTable(entry.pos);
                        }
                    }
                    break;

                case 'CHEST':
                    // Set as primary if none set
                    if (!bb.sharedChest) {
                        const block = bot.blockAt(entry.pos);
                        if (block?.name === 'chest' || block?.name === 'barrel') {
                            bb.sharedChest = entry.pos;
                            bb.villageChat?.setSharedChest(entry.pos);
                        }
                    }
                    break;

                case 'FARM':
                    // Add to known farms if not already known
                    const farmExists = bb.knownFarms.some(f => f.distanceTo(entry.pos) < 20);
                    if (!farmExists) {
                        bb.knownFarms.push(entry.pos);
                        // Consider setting this as farm center if we don't have one
                        if (!bb.farmCenter) {
                            // Check if there's water nearby the signed farm location
                            const waterNearby = bot.findBlocks({
                                point: entry.pos,
                                maxDistance: 8,
                                count: 1,
                                matching: b => b?.name === 'water' || b?.name === 'flowing_water'
                            });
                            if (waterNearby.length > 0 && waterNearby[0]) {
                                bb.farmCenter = new Vec3(waterNearby[0].x, waterNearby[0].y, waterNearby[0].z);
                                bb.log?.info({ pos: bb.farmCenter.toString() }, 'Set farm center from sign knowledge');
                            }
                        }
                    }
                    break;

                case 'WATER':
                    // Add to known water sources
                    const waterExists = bb.knownWaterSources.some(w => w.distanceTo(entry.pos) < 10);
                    if (!waterExists) {
                        bb.knownWaterSources.push(entry.pos);
                    }
                    break;

                // Other landmarks noted but not acted on
                case 'FOREST':
                case 'MINE':
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

        bb.log?.info({ learnedCount: learned.length }, 'Finished studying spawn signs');
        bb.hasStudiedSigns = true;
        return 'success';
    }
}
