import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import {
    studySpawnSignsWorkflow,
    type LearnedSignEntry
} from '../../../../shared/StudySignsWorkflow';

/**
 * StudySpawnSigns - Walk to spawn and study knowledge signs (roleplay + learning)
 *
 * Uses shared workflow that walks to each sign, looks at it, and pauses to "read".
 * Lumberjack-specific: learns about FOREST, FARM, CHEST, CRAFT, VILLAGE
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        return studySpawnSignsWorkflow(bot, bb, applyLumberjackKnowledge);
    }
}

/**
 * Apply lumberjack-specific knowledge from signs
 */
function applyLumberjackKnowledge(
    bot: Bot,
    bb: LumberjackBlackboard,
    learned: LearnedSignEntry[]
): void {
    for (const entry of learned) {
        switch (entry.type) {
            case 'VILLAGE':
                if (!bb.villageCenter) {
                    bb.villageCenter = entry.pos;
                    bb.villageChat?.setVillageCenter(entry.pos);
                }
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
                // Add to known chests array if not already known
                const chestExists = bb.knownChests.some(c => c.distanceTo(entry.pos) < 2);
                if (!chestExists) {
                    const block = bot.blockAt(entry.pos);
                    if (block?.name === 'chest' || block?.name === 'barrel') {
                        bb.knownChests.push(entry.pos);
                        // Set as primary if none set
                        if (!bb.sharedChest) {
                            bb.sharedChest = entry.pos;
                            bb.villageChat?.setSharedChest(entry.pos);
                        }
                    }
                }
                break;

            case 'FOREST':
                // Add to known forests if not already known
                const forestExists = bb.knownForests.some(f => f.distanceTo(entry.pos) < 20);
                if (!forestExists) {
                    bb.knownForests.push(entry.pos);
                }
                // Mark that we know about a forest - no need to search!
                bb.hasKnownForest = true;
                break;

            case 'FARM':
                // Add to known farms - we avoid planting saplings near these!
                const farmExists = bb.knownFarms.some(f => f.distanceTo(entry.pos) < 20);
                if (!farmExists) {
                    bb.knownFarms.push(entry.pos);
                    bb.log?.info({ pos: entry.pos.toString() }, 'Learned farm location - will avoid planting saplings nearby');
                }
                break;

            case 'MINE':
            case 'WATER':
                bb.log?.debug({ type: entry.type, pos: entry.pos.toString() }, 'Noted landmark');
                break;
        }
    }
}
