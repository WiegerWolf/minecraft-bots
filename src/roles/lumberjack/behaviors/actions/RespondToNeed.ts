import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import { BaseRespondToNeed } from '../../../../shared/actions/BaseRespondToNeed';
import type { ItemStack, NeedOffer } from '../../../../shared/needs/types';

// Tool items that lumberjack can offer
const TOOL_PATTERNS = [
    'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe', 'netherite_hoe',
    'wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'netherite_axe',
];

/**
 * RespondToNeed - Respond to intent-based needs from other bots.
 *
 * The lumberjack can provide:
 * - Logs (directly harvested)
 * - Planks (crafted from logs)
 * - Sticks (crafted from planks)
 * - Tools (wooden/stone axes, hoes, etc.)
 *
 * When another bot broadcasts a need (e.g., [NEED] hoe), this action:
 * 1. Checks if we can satisfy the need (have item or materials)
 * 2. Sends an offer describing what we can provide
 * 3. If accepted, delivers via shared chest or trade
 */
export class RespondToNeed extends BaseRespondToNeed<LumberjackBlackboard> {
    constructor() {
        super({
            roleLabel: 'Lumberjack',
            canProvideCategories: ['log', 'planks', 'stick', 'hoe', 'axe'],
            logLevel: 'info',
        });
    }

    /**
     * Get current inventory as ItemStacks.
     * Scans both blackboard (for cached counts) and actual bot inventory (for tools).
     */
    protected getInventory(bot: Bot, bb: LumberjackBlackboard): ItemStack[] {
        const inventory: ItemStack[] = [];

        // Count logs by type
        if (bb.logCount > 0) {
            // We don't know exact log types from bb, so report as generic
            // In a more sophisticated implementation, we'd track this
            inventory.push({ name: 'oak_log', count: bb.logCount });
        }

        // Count planks
        if (bb.plankCount > 0) {
            inventory.push({ name: 'oak_planks', count: bb.plankCount });
        }

        // Count sticks
        if (bb.stickCount > 0) {
            inventory.push({ name: 'stick', count: bb.stickCount });
        }

        // Scan actual bot inventory for tools
        for (const item of bot.inventory.items()) {
            if (TOOL_PATTERNS.includes(item.name)) {
                // Check if we already have this item type
                const existing = inventory.find(i => i.name === item.name);
                if (existing) {
                    existing.count += item.count;
                } else {
                    inventory.push({ name: item.name, count: item.count });
                }
            }
        }

        return inventory;
    }

    /**
     * Check if we can spare the given items.
     * Lumberjack should keep some logs for themselves, but can give away spare tools.
     */
    protected canSpareItems(bb: LumberjackBlackboard, items: ItemStack[]): boolean {
        // Check if giving away tools
        const toolsToGive = items.filter(i => TOOL_PATTERNS.includes(i.name));
        if (toolsToGive.length > 0) {
            // Willing to give away tools (especially hoes which lumberjack doesn't need)
            // But keep our axe
            const givingAwayAxe = toolsToGive.some(i => i.name.includes('axe'));
            if (givingAwayAxe && bb.hasAxe) {
                // Only give away axe if we have another one
                // For now, assume we can spare non-axe tools
                return false;
            }
            return true;
        }

        // Calculate what we'd be giving away for materials
        const logsToGive = items
            .filter(i => i.name.includes('log'))
            .reduce((sum, i) => sum + i.count, 0);

        const planksToGive = items
            .filter(i => i.name.includes('planks'))
            .reduce((sum, i) => sum + i.count, 0);

        const sticksToGive = items
            .filter(i => i.name === 'stick')
            .reduce((sum, i) => sum + i.count, 0);

        // Keep at least 2 logs for ourselves (for tools/emergencies)
        const remainingLogs = bb.logCount - logsToGive;
        if (remainingLogs < 2 && logsToGive > 0) {
            return false;
        }

        // Keep at least 4 planks
        const remainingPlanks = bb.plankCount - planksToGive;
        if (remainingPlanks < 4 && planksToGive > 0) {
            return false;
        }

        // Keep at least 2 sticks
        const remainingSticks = bb.stickCount - sticksToGive;
        if (remainingSticks < 2 && sticksToGive > 0) {
            return false;
        }

        // If we have plenty (more than 16 logs), we can be more generous
        if (bb.logCount > 16) {
            return true;
        }

        // Otherwise, only give if we have enough to spare
        return remainingLogs >= 0 && remainingPlanks >= 0 && remainingSticks >= 0;
    }

    /**
     * Custom handling when our offer is accepted.
     */
    protected override onOfferAccepted(
        _bot: Bot,
        bb: LumberjackBlackboard,
        needId: string,
        requester: string
    ): void {
        bb.log?.info(
            { needId, requester },
            '[Lumberjack] Our offer was accepted, preparing delivery'
        );
    }

    /**
     * Custom handling when delivery is complete.
     */
    protected override onDeliveryComplete(
        _bot: Bot,
        bb: LumberjackBlackboard,
        needId: string
    ): void {
        bb.log?.info(
            { needId },
            '[Lumberjack] Successfully fulfilled need'
        );
    }

    /**
     * Custom handling when we send an offer.
     */
    protected override onOfferSent(
        _bot: Bot,
        bb: LumberjackBlackboard,
        needId: string,
        offer: NeedOffer
    ): void {
        bb.log?.info(
            {
                needId,
                offerType: offer.type,
                items: offer.items.map(i => `${i.count}x ${i.name}`).join(', '),
                craftingSteps: offer.craftingSteps,
            },
            '[Lumberjack] Offered to help with need'
        );
    }
}
