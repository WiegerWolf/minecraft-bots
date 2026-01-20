import type { Bot } from 'mineflayer';
import type { LandscaperBlackboard } from '../../LandscaperBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import {
    studySpawnSignsWorkflow,
    type LearnedSignEntry
} from '../../../../shared/StudySignsWorkflow';

/**
 * StudySpawnSigns - Walk to spawn and study knowledge signs (roleplay + learning)
 *
 * Uses shared workflow that walks to each sign, looks at it, and pauses to "read".
 * Landscaper-specific: learns about FARM, VILLAGE, CHEST, CRAFT, DIRTPIT
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: LandscaperBlackboard): Promise<BehaviorStatus> {
        return studySpawnSignsWorkflow(bot, bb, applyLandscaperKnowledge);
    }
}

/**
 * Apply landscaper-specific knowledge from signs
 */
function applyLandscaperKnowledge(
    bot: Bot,
    bb: LandscaperBlackboard,
    learned: LearnedSignEntry[]
): void {
    for (const entry of learned) {
        switch (entry.type) {
            case 'FARM':
                // Add to known farms if not already known
                const farmExists = bb.knownFarms.some(f => f.distanceTo(entry.pos) < 10);
                if (!farmExists) {
                    bb.knownFarms.push(entry.pos.clone());
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
}
