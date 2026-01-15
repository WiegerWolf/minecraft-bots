import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalNear } = goals;

export class PickupTask implements Task {
    name = 'pickup';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // If we have space, look for dropped items
        if (bot.inventory.emptySlotCount() === 0) return null;

        // Find nearest dropped item
        const itemDrop = bot.nearestEntity(e => {
            return e.type === 'object' || e.type === 'orb';
        });

        if (itemDrop && bot.entity.position.distanceTo(itemDrop.position) < 20) {
             return {
                priority: 30, 
                description: `Picking up item at ${itemDrop.position.floored()}`,
                target: itemDrop,
                range: 1.0, 
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;
        
        try {
            // FIX: Walk to the item!
            await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 1));
            
            // Wait briefly to ensure pickup registration
            await new Promise(r => setTimeout(r, 200));
        } catch (err) {
            // Ignore movement errors for drops, they might despawn or move
        }
    }
}