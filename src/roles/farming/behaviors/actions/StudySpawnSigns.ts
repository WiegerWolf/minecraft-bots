import type { Bot } from 'mineflayer';
import type { FarmingBlackboard } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import {
    studySpawnSignsWorkflow,
    type LearnedSignEntry
} from '../../../../shared/StudySignsWorkflow';

/**
 * StudySpawnSigns - Walk to spawn and study knowledge signs (roleplay + learning)
 *
 * Uses shared workflow that walks to each sign, looks at it, and pauses to "read".
 * Farmer-specific: learns about FARM, WATER, CHEST, CRAFT, VILLAGE
 */
export class StudySpawnSigns implements BehaviorNode {
    name = 'StudySpawnSigns';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        return studySpawnSignsWorkflow(bot, bb, applyFarmerKnowledge);
    }
}

/**
 * Apply farmer-specific knowledge from signs
 */
function applyFarmerKnowledge(
    bot: Bot,
    bb: FarmingBlackboard,
    learned: LearnedSignEntry[]
): void {
    for (const entry of learned) {
        switch (entry.type) {
            case 'VILLAGE':
                if (!bb.villageCenter) {
                    bb.villageCenter = entry.pos;
                    bb.villageChat?.setVillageCenter(entry.pos);
                    bb.log?.info({ pos: entry.pos.toString() }, 'Learned village center from sign');
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
                if (!bb.sharedChest) {
                    const block = bot.blockAt(entry.pos);
                    if (block?.name === 'chest' || block?.name === 'barrel') {
                        bb.sharedChest = entry.pos;
                        bb.villageChat?.setSharedChest(entry.pos);
                    }
                }
                break;

            case 'FARM':
                const farmExists = bb.knownFarms.some(f => f.distanceTo(entry.pos) < 20);
                if (!farmExists) {
                    bb.knownFarms.push(entry.pos);
                    // Set as farm center if we don't have one and there's water nearby
                    if (!bb.farmCenter) {
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
                const waterExists = bb.knownWaterSources.some(w => w.distanceTo(entry.pos) < 10);
                if (!waterExists) {
                    bb.knownWaterSources.push(entry.pos);
                }
                break;

            case 'FOREST':
            case 'MINE':
                bb.log?.debug({ type: entry.type, pos: entry.pos.toString() }, 'Noted landmark');
                break;
        }
    }
}
