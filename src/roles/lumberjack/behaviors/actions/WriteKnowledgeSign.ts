import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard, PendingSignWrite } from '../../LumberjackBlackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { GoalNear } from 'baritone-ts';
import { pathfinderGotoWithRetry, sleep } from '../../../../shared/PathfindingUtils';
import {
    formatSignText,
    getSignPositionForType,
    findExistingSignForType,
    findValidSignPosition,
    getAlternativeSignPositions,
    type SignKnowledgeType
} from '../../../../shared/SignKnowledge';

/**
 * WriteKnowledgeSign - Write pending knowledge to signs at spawn
 *
 * This action processes the pendingSignWrites queue, crafting signs if needed
 * and placing them near spawn with infrastructure coordinates.
 *
 * Sign recipe: 6 planks + 1 stick = 3 signs (requires crafting table)
 */
export class WriteKnowledgeSign implements BehaviorNode {
    name = 'WriteKnowledgeSign';

    async tick(bot: Bot, bb: LumberjackBlackboard): Promise<BehaviorStatus> {
        // Need spawn position and pending writes
        if (!bb.spawnPosition || bb.pendingSignWrites.length === 0) {
            return 'failure';
        }

        const pending = bb.pendingSignWrites[0];
        if (!pending) {
            return 'failure';
        }

        bb.lastAction = 'write_knowledge_sign';
        bb.log?.info({ type: pending.type, pos: pending.pos.toString() }, 'Writing knowledge sign');

        // Check if we already have a sign for this type that we can update
        const existingSign = findExistingSignForType(bot, bb.spawnPosition, pending.type);
        if (existingSign) {
            const success = await this.updateExistingSign(bot, bb, existingSign, pending);
            if (success) {
                bb.pendingSignWrites.shift();
                return 'success';
            }
            return 'failure';
        }

        // Need to place a new sign
        const success = await this.placeNewSign(bot, bb, pending);
        if (success) {
            bb.pendingSignWrites.shift();
            return 'success';
        }

        return 'failure';
    }

    private async updateExistingSign(
        bot: Bot,
        bb: LumberjackBlackboard,
        signBlock: any,
        pending: PendingSignWrite
    ): Promise<boolean> {
        try {
            // Move near the sign
            const success = await pathfinderGotoWithRetry(
                bot,
                new GoalNear(signBlock.position.x, signBlock.position.y, signBlock.position.z, 3)
            );
            if (!success) {
                bb.log?.debug('Failed to reach existing sign');
                return false;
            }

            // Update the sign text
            const lines = formatSignText(pending.type, pending.pos);
            const frontText = lines.join('\n');

            await bot.updateSign(signBlock, frontText);
            bb.signPositions.set(pending.type, signBlock.position);

            // Announce FOREST signs to help other bots and players
            if (pending.type === 'FOREST') {
                bot.chat(`Marked forest at ${Math.floor(pending.pos.x)}, ${Math.floor(pending.pos.z)}`);
            }

            bb.log?.info(
                { type: pending.type, pos: pending.pos.toString(), signPos: signBlock.position.toString() },
                'Updated existing knowledge sign'
            );

            return true;
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to update existing sign');
            return false;
        }
    }

    private async placeNewSign(
        bot: Bot,
        bb: LumberjackBlackboard,
        pending: PendingSignWrite
    ): Promise<boolean> {
        // Ensure we have a sign
        const hasSign = await this.ensureHasSign(bot, bb);
        if (!hasSign) {
            bb.log?.debug('Cannot place sign - no signs available and cannot craft');
            return false;
        }

        // Get the preferred placement position for this sign type
        const targetPos = getSignPositionForType(bb.spawnPosition!, pending.type);

        // Try to place at target position or find alternative
        const placed = await this.tryPlaceSign(bot, bb, targetPos, pending);
        if (placed) {
            return true;
        }

        // Try alternative positions near spawn (shared utility)
        const alternativePositions = getAlternativeSignPositions(bb.spawnPosition!);
        for (const altPos of alternativePositions) {
            const placedAlt = await this.tryPlaceSign(bot, bb, altPos, pending);
            if (placedAlt) {
                return true;
            }
        }

        bb.log?.warn({ type: pending.type }, 'Failed to find suitable position for sign');
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
            bb.log?.debug('Crafted signs');
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
        pending: PendingSignWrite
    ): Promise<boolean> {
        // Find a valid Y level at this X,Z position (shared utility)
        const validPos = findValidSignPosition(bot, targetPos);
        if (!validPos) {
            return false;
        }

        // Use the adjusted position with valid ground
        const groundBlock = bot.blockAt(validPos.offset(0, -1, 0));
        const targetBlock = bot.blockAt(validPos);

        if (!groundBlock || groundBlock.boundingBox !== 'block') {
            return false;
        }

        if (!targetBlock || targetBlock.name !== 'air') {
            return false;
        }

        // Update targetPos to the valid position for placement
        targetPos = validPos;

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
                bb.log?.debug({ blockName: placedBlock?.name }, 'Sign placement verification failed');
                return false;
            }

            // Write the knowledge to the sign
            const lines = formatSignText(pending.type, pending.pos);
            const frontText = lines.join('\n');

            await bot.updateSign(placedBlock, frontText);
            bb.signPositions.set(pending.type, targetPos);

            // Announce FOREST signs to help other bots and players
            if (pending.type === 'FOREST') {
                bot.chat(`Placed FOREST sign at ${Math.floor(pending.pos.x)}, ${Math.floor(pending.pos.z)}`);
            }

            bb.log?.info(
                { type: pending.type, pos: pending.pos.toString(), signPos: targetPos.toString() },
                'Placed and wrote knowledge sign'
            );

            return true;
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to place sign');
            return false;
        }
    }

}
