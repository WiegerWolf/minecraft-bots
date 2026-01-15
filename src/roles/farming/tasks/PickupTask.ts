// ./src/roles/farming/tasks/PickupTask.ts
import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class PickupTask implements Task {
    name = 'pickup';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        const inventoryCount = bot.inventory.items().length;

        // If Inventory is full, ignore drops (unless consolidating, but simple for now)
        if (bot.inventory.emptySlotCount() === 0) return null;

        // Is this a fresh bot?
        const isUrgent = inventoryCount < 3;

        // Find nearest dropped item or XP orb
        const itemDrop = bot.nearestEntity(e => {
            return e.name === 'item' || e.type === 'object' || e.type === 'orb';
        });

        if (!itemDrop) {
            // Debug log only if we suspect there should be items (e.g. active scavenging)
            // role.log("No items found nearby.");
            return null;
        }

        const dist = bot.entity.position.distanceTo(itemDrop.position);
        // role.log(`[Pickup] Found item ${itemDrop.name} at ${dist.toFixed(1)}m. Urgent: ${isUrgent}`);

        // Logic:
        // 1. If urgent (empty inventory), NO distance limit. Go get it.
        // 2. If normal operation, only pick up nearby items to avoid distraction.
        if (!isUrgent && dist > 32) return null;

        // --- Dynamic Priority ---
        let priority = 75;

        if (isUrgent) {
            priority = 100; // CRITICAL: Stop everything else
        } else if (dist < 5) {
            priority = 95; // High: Clean up mess near feet
        }

        return {
            priority: priority,
            description: `Picking up ${itemDrop.objectType || 'item'} at ${itemDrop.position.floored()} (${dist.toFixed(1)}m)`,
            target: itemDrop,
            range: 1.0,
            task: this
        };
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;

        try {
            // Go to the item
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 0.5));

            // Wait slightly for server pickup event
            await new Promise(r => setTimeout(r, 250));
        } catch (err) {
            // Ignore pathfinding errors for drops (they move/despawn)
        }
    }
}