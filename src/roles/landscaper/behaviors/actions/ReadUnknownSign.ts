import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';
import {
    readSignText,
    parseSignText,
    getTypeName,
    type SignKnowledgeType
} from '../../../../shared/SignKnowledge';

const { GoalNear } = goals;

/**
 * ReadUnknownSign - Curious bot behavior to read unknown signs
 *
 * When the landscaper spots a sign it hasn't read yet, this action:
 * 1. Walks to the sign
 * 2. Looks at it (faces the block)
 * 3. Reads and parses the content
 * 4. If it's a knowledge sign, learns from it (especially FARM signs!)
 * 5. If it's decoration/graffiti, just says what it saw
 * 6. Marks the sign as read so we don't revisit it
 *
 * For landscapers, FARM signs are especially valuable - they add new
 * farms to check and maintain.
 */
export class ReadUnknownSign implements BehaviorNode {
    name = 'ReadUnknownSign';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        // No unknown signs to read
        if (bb.unknownSigns.length === 0) {
            return 'failure';
        }

        // Pick the closest unknown sign
        const botPos = bot.entity.position;
        const sortedSigns = [...bb.unknownSigns].sort(
            (a, b) => a.distanceTo(botPos) - b.distanceTo(botPos)
        );
        const targetPos = sortedSigns[0]!;

        bb.lastAction = 'read_unknown_sign';
        bb.log?.info({ signPos: targetPos.toString() }, 'Curious about nearby sign, going to read it');

        // Walk to the sign
        try {
            const signGoal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
            const result = await smartPathfinderGoto(bot, signGoal, { timeoutMs: 10000 });
            if (!result.success) {
                bb.log?.debug({ signPos: targetPos.toString(), reason: result.failureReason }, 'Could not reach sign');
                this.markSignRead(bb, targetPos);
                return 'failure';
            }
        } catch (err) {
            bb.log?.debug({ err }, 'Error walking to sign');
            this.markSignRead(bb, targetPos);
            return 'failure';
        }

        // Look at the sign
        const signBlock = bot.blockAt(targetPos);
        if (!signBlock || !signBlock.name.includes('_sign')) {
            bb.log?.debug({ pos: targetPos.toString() }, 'Sign no longer exists');
            this.markSignRead(bb, targetPos);
            return 'failure';
        }

        await bot.lookAt(signBlock.position.offset(0.5, 0.5, 0.5));
        await sleep(400); // Pause to "read"

        // Read the sign
        const lines = readSignText(signBlock);
        const entry = parseSignText(lines);

        // Mark as read
        this.markSignRead(bb, targetPos);

        if (entry) {
            // It's a knowledge sign - learn from it!
            this.learnFromSign(bot, bb, entry);
            const typeName = getTypeName(entry.type);
            const posStr = `(${Math.floor(entry.pos.x)}, ${Math.floor(entry.pos.y)}, ${Math.floor(entry.pos.z)})`;
            bot.chat(`Found a sign about ${typeName} at ${posStr}!`);
            bb.log?.info({ type: entry.type, pos: entry.pos.toString() }, 'Learned from wild sign');
        } else {
            // Not a knowledge sign - just decoration or player message
            const text = lines.filter(l => l.trim()).join(' ');
            if (text) {
                bot.chat(`Read a sign: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`);
            } else {
                bot.chat('Found an empty sign.');
            }
            bb.log?.debug({ lines }, 'Read non-knowledge sign');
        }

        return 'success';
    }

    /**
     * Mark a sign position as read so we don't revisit it.
     */
    private markSignRead(bb: LandscaperBlackboard, pos: Vec3): void {
        const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        bb.readSignPositions.add(key);

        // Remove from unknownSigns
        bb.unknownSigns = bb.unknownSigns.filter(
            s => !(Math.floor(s.x) === Math.floor(pos.x) &&
                   Math.floor(s.y) === Math.floor(pos.y) &&
                   Math.floor(s.z) === Math.floor(pos.z))
        );
    }

    /**
     * Learn from a knowledge sign - update blackboard state.
     * Landscapers especially care about FARM signs (new farms to maintain)
     * and CHEST/CRAFT signs (infrastructure).
     */
    private learnFromSign(bot: Bot, bb: LandscaperBlackboard, entry: { type: SignKnowledgeType; pos: Vec3 }): void {
        switch (entry.type) {
            case 'VILLAGE':
                // Note village center
                if (!bb.villageCenter) {
                    bb.villageCenter = entry.pos;
                    bb.villageChat?.setVillageCenter(entry.pos);
                }
                bb.log?.debug({ pos: entry.pos.toString() }, 'Noted village center');
                break;

            case 'CRAFT':
                if (!bb.sharedCraftingTable) {
                    const block = bot.blockAt(entry.pos);
                    if (block?.name === 'crafting_table') {
                        bb.sharedCraftingTable = entry.pos;
                        bb.villageChat?.setSharedCraftingTable(entry.pos);
                    }
                }
                break;

            case 'CHEST':
                if (!bb.sharedChest) {
                    const block = bot.blockAt(entry.pos);
                    if (block?.name === 'chest' || block?.name === 'barrel') {
                        bb.sharedChest = entry.pos;
                        bb.villageChat?.setSharedChest(entry.pos);
                    }
                }
                break;

            case 'FARM':
                // MOST IMPORTANT for landscapers - add to known farms!
                const farmExists = bb.knownFarms.some(
                    f => f.distanceTo(entry.pos) < 20
                );
                if (!farmExists) {
                    bb.knownFarms.push(entry.pos);
                    bb.farmsNeedingCheck.push(entry.pos);
                    bb.log?.info({ pos: entry.pos.toString() }, 'Discovered new farm to maintain!');
                }
                break;

            case 'WATER':
                // Note water sources (useful for terraforming decisions)
                bb.log?.debug({ pos: entry.pos.toString() }, 'Noted water source');
                break;

            // Other landmark types noted but not critical for landscaper
            case 'FOREST':
            case 'MINE':
                bb.log?.debug({ type: entry.type, pos: entry.pos.toString() }, 'Noted landmark');
                break;
        }
    }
}
