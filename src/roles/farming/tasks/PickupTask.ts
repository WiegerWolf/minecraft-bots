import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class PickupTask implements Task {
    name = 'pickup';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        if (bot.inventory.emptySlotCount() === 0) return null;

        // Find nearest dropped item or XP orb
        const itemDrop = bot.nearestEntity(e => {
            return e.type === 'object' || e.type === 'orb';
        });

        if (!itemDrop) return null;

        const dist = bot.entity.position.distanceTo(itemDrop.position);
        
        // FIX: Increased range to catch items from previous bot death
        if (dist > 64) return null;

        // --- Dynamic Priority ---
        let priority = 75; 

        // 1. Fresh Spawn Priority
        const inventoryCount = bot.inventory.items().length;
        if (inventoryCount < 3) {
            priority = 100; // Critical priority
        }

        // 2. Proximity Priority
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
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 0.5));
            await new Promise(r => setTimeout(r, 350));
        } catch (err) {
            // Ignore movement errors for drops
        }
    }
}