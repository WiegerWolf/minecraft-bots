import type { Bot } from 'mineflayer';
import type { LumberjackBlackboard } from '../../LumberjackBlackboard';
import { BaseRespondToNeed } from '../../../../shared/actions/BaseRespondToNeed';
import type { ItemStack, NeedOffer } from '../../../../shared/needs/types';

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
     */
    protected getInventory(bb: LumberjackBlackboard): ItemStack[] {
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

        // Check for tools in inventory
        // TODO: Add more detailed inventory scanning for actual tools

        return inventory;
    }

    /**
     * Check if we can spare the given items.
     * Lumberjack should keep some logs for themselves.
     */
    protected canSpareItems(bb: LumberjackBlackboard, items: ItemStack[]): boolean {
        // Calculate what we'd be giving away
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
