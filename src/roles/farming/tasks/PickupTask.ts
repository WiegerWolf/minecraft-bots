import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class PickupTask implements Task {
    name = 'pickup';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // If full, we can't pick up (unless we want to merge stacks, but simple check for now)
        if (bot.inventory.emptySlotCount() === 0) return null;

        // Find nearest dropped item or XP orb
        const itemDrop = bot.nearestEntity(e => {
            return e.type === 'object' || e.type === 'orb';
        });

        if (!itemDrop) return null;

        const dist = bot.entity.position.distanceTo(itemDrop.position);
        
        // Scan range matching standard vision
        if (dist > 32) return null;

        // --- Dynamic Priority Calculation ---
        let priority = 75; // Base: Higher than Maintenance(50) and Tilling(15)

        // 1. Fresh Spawn / Empty Inventory Priority
        // If we have less than 3 items, we likely just spawned and need our stuff back.
        const inventoryCount = bot.inventory.items().length;
        if (inventoryCount < 3) {
            priority = 100; // Critical priority
        }

        // 2. Proximity Priority
        // If it's right next to us, pick it up immediately to avoid walking away and coming back.
        if (dist < 5) {
            priority = 90;
        }

        return {
            priority: priority, 
            description: `Picking up item/orb at ${itemDrop.position.floored()}`,
            target: itemDrop,
            range: 1.0, 
            task: this
        };
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;
        
        try {
            // Move directly to the item location (Range 0.5 to actually touch it)
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 0.5));
            
            // Wait a moment for the server to process the pickup
            // This prevents the bot from "stuttering" (picking up 1 item, stopping, planning path to next item 0.5 blocks away)
            await new Promise(r => setTimeout(r, 350));

        } catch (err) {
            // Ignore movement errors for drops; items might despawn, be picked up by others, or physics might move them.
        }
    }
}