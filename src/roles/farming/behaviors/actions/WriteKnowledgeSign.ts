import type { Bot } from 'mineflayer';
import type { FarmingBlackboard, PendingSignWrite } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';
import { Vec3 } from 'vec3';
import { GoalNear } from 'baritone-ts';
import { smartPathfinderGoto, sleep } from '../../../../shared/PathfindingUtils';
import {
    formatSignText,
    getSignPositionForType,
    findExistingSignForType,
    findValidSignPosition,
    getAlternativeSignPositions,
} from '../../../../shared/SignKnowledge';

/**
 * WriteKnowledgeSign - Write pending knowledge to signs at spawn
 *
 * This action processes the pendingSignWrites queue, crafting signs if needed
 * and placing them near spawn with farm/water coordinates.
 *
 * Sign recipe: 6 planks + 1 stick = 3 signs (requires crafting table)
 *
 * Materials can come from:
 * - Existing inventory (from chest withdrawal)
 * - Shared chest (lumberjack deposits)
 * - Requesting from lumberjack if no materials available
 */
export class WriteKnowledgeSign implements BehaviorNode {
    name = 'WriteKnowledgeSign';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
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
        bb: FarmingBlackboard,
        signBlock: any,
        pending: PendingSignWrite
    ): Promise<boolean> {
        try {
            // Move near the sign
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(signBlock.position.x, signBlock.position.y, signBlock.position.z, 3),
                { timeoutMs: 10000 }
            );
            if (!result.success) {
                bb.log?.debug({ reason: result.failureReason }, 'Failed to reach existing sign');
                return false;
            }

            // Update the sign text
            const lines = formatSignText(pending.type, pending.pos);
            const frontText = lines.join('\n');

            await bot.updateSign(signBlock, frontText);
            bb.signPositions.set(pending.type, signBlock.position);

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
        bb: FarmingBlackboard,
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
        bb.log?.debug(
            { type: pending.type, primaryPos: targetPos.toString(), botPos: bot.entity.position.floored().toString() },
            'Attempting to place sign at primary position'
        );

        // Try to place at target position or find alternative
        const placed = await this.tryPlaceSign(bot, bb, targetPos, pending, 'primary');
        if (placed) {
            return true;
        }

        // Try alternative positions near spawn (shared utility)
        const alternativePositions = getAlternativeSignPositions(bb.spawnPosition!);
        bb.log?.debug(
            { type: pending.type, alternativeCount: alternativePositions.length },
            'Primary position failed, trying alternatives'
        );

        let attemptCount = 0;
        for (const altPos of alternativePositions) {
            attemptCount++;
            const placedAlt = await this.tryPlaceSign(bot, bb, altPos, pending, `alt-${attemptCount}`);
            if (placedAlt) {
                return true;
            }
        }

        bb.log?.warn({ type: pending.type, attemptCount }, 'Failed to find suitable position for sign');
        return false;
    }

    private async ensureHasSign(bot: Bot, bb: FarmingBlackboard): Promise<boolean> {
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
            // Move to crafting table - get within 2 blocks (closer for crafting to work)
            const result = await smartPathfinderGoto(
                bot,
                new GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 2),
                { timeoutMs: 10000 }
            );
            if (!result.success) {
                return false;
            }

            // Get a FRESH block reference after pathfinding (the old one may be stale)
            const freshCraftingTable = bot.blockAt(craftingTable.position);
            if (!freshCraftingTable || freshCraftingTable.name !== 'crafting_table') {
                bb.log?.warn(
                    { pos: craftingTable.position.toString(), foundBlock: freshCraftingTable?.name },
                    'Crafting table not found at expected position after pathfinding'
                );
                return false;
            }

            // Craft sign (oak_sign is the default)
            const signId = bot.registry.itemsByName['oak_sign']?.id;
            if (!signId) {
                bb.log?.warn('oak_sign not found in registry');
                return false;
            }

            const recipe = bot.recipesFor(signId, null, 1, freshCraftingTable)[0];
            if (!recipe) {
                bb.log?.debug('No recipe found for oak_sign');
                return false;
            }

            await bot.craft(recipe, 1, freshCraftingTable);
            await sleep(200);

            // Verify crafting succeeded
            const signAfter = bot.inventory.items().find(i => i.name.includes('_sign'));
            if (signAfter) {
                bb.log?.debug('Crafted signs');
                return true;
            } else {
                bb.log?.warn('Craft completed but no sign in inventory');
                return false;
            }
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to craft sign');
            return false;
        }
    }

    private async tryPlaceSign(
        bot: Bot,
        bb: FarmingBlackboard,
        targetPos: Vec3,
        pending: PendingSignWrite,
        attemptLabel: string = 'unknown'
    ): Promise<boolean> {
        const posKey = targetPos.floored().toString();

        // Find a valid Y level at this X,Z position (shared utility)
        const validPos = findValidSignPosition(bot, targetPos);
        if (!validPos) {
            bb.log?.debug({ pos: posKey, attempt: attemptLabel }, 'No valid Y level found for sign');
            return false;
        }

        // Use the adjusted position with valid ground
        const groundBlock = bot.blockAt(validPos.offset(0, -1, 0));
        const targetBlock = bot.blockAt(validPos);

        if (!groundBlock || groundBlock.boundingBox !== 'block') {
            bb.log?.debug(
                { pos: posKey, attempt: attemptLabel, groundBlock: groundBlock?.name ?? 'null' },
                'Invalid ground block for sign'
            );
            return false;
        }

        if (!targetBlock || targetBlock.name !== 'air') {
            bb.log?.debug(
                { pos: posKey, attempt: attemptLabel, targetBlock: targetBlock?.name ?? 'null' },
                'Target position not air for sign'
            );
            return false;
        }

        // Update targetPos to the valid position for placement
        targetPos = validPos;
        const dist = bot.entity.position.distanceTo(targetPos);

        bb.log?.debug(
            { pos: targetPos.toString(), attempt: attemptLabel, dist: dist.toFixed(1) },
            'Valid position found, attempting pathfinding'
        );

        try {
            // Move near the placement position
            const pathStartTime = Date.now();
            const pathResult = await smartPathfinderGoto(
                bot,
                new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3),
                { timeoutMs: 10000, logger: bb.log }
            );
            const pathDuration = Date.now() - pathStartTime;

            if (!pathResult.success) {
                bb.log?.debug(
                    { pos: targetPos.toString(), attempt: attemptLabel, durationMs: pathDuration, reason: pathResult.failureReason },
                    'Pathfinding failed for sign placement'
                );
                return false;
            }

            bb.log?.debug(
                { pos: targetPos.toString(), attempt: attemptLabel, durationMs: pathDuration },
                'Pathfinding succeeded, placing sign'
            );

            // Get a sign from inventory
            const signItem = bot.inventory.items().find(i => i.name.includes('_sign'));
            if (!signItem) {
                const invItems = bot.inventory.items().map(i => i.name);
                bb.log?.debug(
                    { attempt: attemptLabel, inventory: invItems.slice(0, 10) },
                    'No sign found in inventory after pathfinding'
                );
                return false;
            }

            bb.log?.debug(
                { attempt: attemptLabel, signName: signItem.name, groundBlock: groundBlock.name },
                'Attempting to place sign block'
            );

            // Place the sign
            await bot.equip(signItem, 'hand');
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
            await sleep(300);

            // Verify the sign was placed
            const placedBlock = bot.blockAt(targetPos);
            if (!placedBlock || !placedBlock.name.includes('_sign')) {
                bb.log?.debug(
                    { attempt: attemptLabel, pos: targetPos.toString(), blockName: placedBlock?.name ?? 'null' },
                    'Sign placement verification failed'
                );
                return false;
            }

            // Write the knowledge to the sign
            const lines = formatSignText(pending.type, pending.pos);
            const frontText = lines.join('\n');

            await bot.updateSign(placedBlock, frontText);
            bb.signPositions.set(pending.type, targetPos);

            bb.log?.info(
                { type: pending.type, pos: pending.pos.toString(), signPos: targetPos.toString() },
                'Placed and wrote knowledge sign'
            );

            // Announce to village chat
            bot.chat(`Placed a ${pending.type} sign at spawn!`);

            return true;
        } catch (err) {
            bb.log?.warn({ err }, 'Failed to place sign');
            return false;
        }
    }

}
