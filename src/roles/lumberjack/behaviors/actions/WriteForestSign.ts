import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';
import {
    formatSignText,
    getSignPositionForType,
    findExistingSignForType,
} from '../../../../shared/SignKnowledge';

const { GoalNear } = goals;

/**
 * WriteForestSign - Write a FOREST sign near spawn
 *
 * After discovering a forest area, this action writes the location to a sign
 * so future lumberjacks can find it immediately without searching.
 *
 * Sign recipe: 6 planks + 1 stick = 3 signs (requires crafting table)
 */
export class WriteForestSign implements BehaviorNode {
    name = 'WriteForestSign';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Need spawn position and a known forest to write about
        if (!bb.spawnPosition || bb.knownForests.length === 0) {
            bb.log?.debug('Cannot write FOREST sign - no spawn position or no known forest');
            return 'failure';
        }

        if (!bb.pendingForestSignWrite) {
            return 'success'; // Nothing to write
        }

        const forestPos = bb.knownForests[0]!;
        bb.lastAction = 'write_forest_sign';
        bb.log?.info({ pos: forestPos.floored().toString() }, 'Writing FOREST sign');

        // Check if we already have a FOREST sign that we can update
        const existingSign = findExistingSignForType(bot, bb.spawnPosition, 'FOREST');
        if (existingSign) {
            const success = await this.updateExistingSign(bot, bb, existingSign, forestPos);
            if (success) {
                bb.pendingForestSignWrite = false;
                return 'success';
            }
            return 'failure';
        }

        // Need to place a new sign
        const success = await this.placeNewSign(bot, bb, forestPos);
        if (success) {
            bb.pendingForestSignWrite = false;
            return 'success';
        }

        return 'failure';
    }

    private async updateExistingSign(
        bot: Bot,
        bb: LumberjackBlackboard,
        signBlock: any,
        forestPos: Vec3
    ): Promise<boolean> {
        try {
            // Move near the sign
            const success = await pathfinderGotoWithRetry(
                bot,
                new GoalNear(signBlock.position.x, signBlock.position.y, signBlock.position.z, 3)
            );
            if (!success) {
                bb.log?.debug('Failed to reach existing FOREST sign');
                return false;
            }

            // Update the sign text
            const lines = formatSignText('FOREST', forestPos);
            const frontText = lines.join('\n');

            await bot.updateSign(signBlock, frontText);
            bb.signPositions.set('FOREST', signBlock.position);

            bot.chat(`Marked forest at ${Math.floor(forestPos.x)}, ${Math.floor(forestPos.z)}`);
            bb.log?.info(
                { forestPos: forestPos.floored().toString(), signPos: signBlock.position.toString() },
                'Updated existing FOREST sign'
            );

            return true;
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to update existing FOREST sign');
            return false;
        }
    }

    private async placeNewSign(
        bot: Bot,
        bb: LumberjackBlackboard,
        forestPos: Vec3
    ): Promise<boolean> {
        // Ensure we have a sign
        const hasSign = await this.ensureHasSign(bot, bb);
        if (!hasSign) {
            bb.log?.debug('Cannot place FOREST sign - no signs available and cannot craft');
            return false;
        }

        // Get the preferred placement position for FOREST sign
        const targetPos = getSignPositionForType(bb.spawnPosition!, 'FOREST');

        // Try to place at target position or find alternative
        const placed = await this.tryPlaceSign(bot, bb, targetPos, forestPos);
        if (placed) {
            return true;
        }

        // Try alternative positions near spawn
        const alternativePositions = this.getAlternativePositions(bb.spawnPosition!);
        for (const altPos of alternativePositions) {
            const placedAlt = await this.tryPlaceSign(bot, bb, altPos, forestPos);
            if (placedAlt) {
                return true;
            }
        }

        bb.log?.warn('Failed to find suitable position for FOREST sign');
        return false;
    }

    private async ensureHasSign(bot: Bot, bb: LumberjackBlackboard): Promise<boolean> {
        // Check if we already have a sign
        const signItem = bot.inventory.items().find(i => i.name.includes('_sign'));
        if (signItem) {
            return true;
        }

        // Need to craft - requires 6 planks + 1 stick at crafting table
        const plankCount = bot.inventory.items()
            .filter(i => i.name.endsWith('_planks'))
            .reduce((sum, i) => sum + i.count, 0);
        const stickCount = bot.inventory.items()
            .filter(i => i.name === 'stick')
            .reduce((sum, i) => sum + i.count, 0);

        if (plankCount < 6 || stickCount < 1) {
            bb.log?.debug({ planks: plankCount, sticks: stickCount }, 'Not enough materials for sign');
            return false;
        }

        // Find a crafting table
        const craftingTable = bb.sharedCraftingTable
            ? bot.blockAt(bb.sharedCraftingTable)
            : bb.nearbyCraftingTables[0];

        if (!craftingTable || craftingTable.name !== 'crafting_table') {
            bb.log?.debug('No crafting table available for sign crafting');
            return false;
        }

        try {
            // Move to crafting table
            const success = await pathfinderGotoWithRetry(
                bot,
                new GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3)
            );
            if (!success) {
                return false;
            }

            // Craft sign (oak_sign is the default)
            const signId = bot.registry.itemsByName['oak_sign']?.id;
            if (!signId) {
                bb.log?.warn('oak_sign not found in registry');
                return false;
            }

            const recipe = bot.recipesFor(signId, null, 1, craftingTable)[0];
            if (!recipe) {
                bb.log?.debug('No recipe found for oak_sign');
                return false;
            }

            await bot.craft(recipe, 1, craftingTable);
            bb.log?.debug('Crafted signs for FOREST marking');
            await sleep(100);
            return true;
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to craft sign');
            return false;
        }
    }

    private async tryPlaceSign(
        bot: Bot,
        bb: LumberjackBlackboard,
        targetPos: Vec3,
        forestPos: Vec3
    ): Promise<boolean> {
        // Check if position is valid for placing a sign
        const groundBlock = bot.blockAt(targetPos.offset(0, -1, 0));
        const targetBlock = bot.blockAt(targetPos);

        if (!groundBlock || groundBlock.boundingBox !== 'block') {
            return false;
        }

        if (!targetBlock || targetBlock.name !== 'air') {
            return false;
        }

        try {
            // Move near the placement position
            const success = await pathfinderGotoWithRetry(
                bot,
                new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3)
            );
            if (!success) {
                return false;
            }

            // Get a sign from inventory
            const signItem = bot.inventory.items().find(i => i.name.includes('_sign'));
            if (!signItem) {
                return false;
            }

            // Place the sign
            await bot.equip(signItem, 'hand');
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
            await sleep(300);

            // Verify the sign was placed
            const placedBlock = bot.blockAt(targetPos);
            if (!placedBlock || !placedBlock.name.includes('_sign')) {
                bb.log?.debug({ blockName: placedBlock?.name }, 'FOREST sign placement verification failed');
                return false;
            }

            // Write the forest location to the sign
            const lines = formatSignText('FOREST', forestPos);
            const frontText = lines.join('\n');

            await bot.updateSign(placedBlock, frontText);
            bb.signPositions.set('FOREST', targetPos);

            bot.chat(`Placed FOREST sign at ${Math.floor(forestPos.x)}, ${Math.floor(forestPos.z)}`);
            bb.log?.info(
                { forestPos: forestPos.floored().toString(), signPos: targetPos.toString() },
                'Placed and wrote FOREST sign'
            );

            return true;
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to place FOREST sign');
            return false;
        }
    }

    private getAlternativePositions(spawnPos: Vec3): Vec3[] {
        const alternatives: Vec3[] = [];
        // Spiral outward from spawn
        for (let radius = 2; radius <= 6; radius += 2) {
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    // Only positions on the edge of the square
                    if (Math.abs(x) === radius || Math.abs(z) === radius) {
                        alternatives.push(new Vec3(spawnPos.x + x, spawnPos.y, spawnPos.z + z));
                    }
                }
            }
        }
        return alternatives;
    }
}
