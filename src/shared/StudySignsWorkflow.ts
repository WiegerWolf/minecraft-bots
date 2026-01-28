import type { Bot } from 'mineflayer';
import type { Logger } from 'pino';
import { Vec3 } from 'vec3';
import { GoalNear } from 'baritone-ts';
import { smartPathfinderGoto, sleep } from './PathfindingUtils';
import {
    findSignsNear,
    readSignText,
    parseSignText,
    getTypeName,
    SIGN_SEARCH_RADIUS,
    type SignKnowledgeType
} from './SignKnowledge';

/**
 * Parsed sign entry with position info
 */
export interface LearnedSignEntry {
    type: SignKnowledgeType;
    pos: Vec3;
    signPos: Vec3;
}

/**
 * Common blackboard interface required for sign study workflow
 */
export interface SignStudyBlackboard {
    hasStudiedSigns: boolean;
    spawnPosition?: Vec3 | null;
    lastAction?: string;
    readSignPositions: Set<string>;
    log?: Logger | null;
}

/**
 * Handler function that applies learned knowledge to role-specific blackboard
 */
export type ApplyKnowledgeHandler<TBlackboard extends SignStudyBlackboard> = (
    bot: Bot,
    bb: TBlackboard,
    learned: LearnedSignEntry[]
) => void;

/**
 * Shared workflow for studying spawn signs across all roles
 *
 * This provides a roleplay-friendly experience where bots:
 * 1. Walk to spawn area
 * 2. Find all signs near spawn
 * 3. Walk to each sign, look at it, wait 500ms to "read"
 * 4. Parse sign content
 * 5. Apply role-specific knowledge via handler
 * 6. Announce what was learned via chat
 *
 * @param bot The mineflayer bot instance
 * @param bb The role's blackboard (must implement SignStudyBlackboard)
 * @param applyKnowledge Role-specific handler to apply learned knowledge
 * @returns 'success' or 'failure'
 */
export async function studySpawnSignsWorkflow<TBlackboard extends SignStudyBlackboard>(
    bot: Bot,
    bb: TBlackboard,
    applyKnowledge: ApplyKnowledgeHandler<TBlackboard>
): Promise<'success' | 'failure'> {
    // Already studied
    if (bb.hasStudiedSigns) {
        return 'success';
    }

    // Need spawn position - use current position if not set
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
    const learned: LearnedSignEntry[] = [];

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

    // Apply role-specific knowledge
    applyKnowledge(bot, bb, learned);

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
