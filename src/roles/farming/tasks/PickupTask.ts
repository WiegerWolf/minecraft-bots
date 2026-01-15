import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';

export class PickupTask implements Task {
    name = 'pickup';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // If we have space, look for dropped items
        if (bot.inventory.emptySlotCount() === 0) return null;

        // Find nearest dropped item
        // e.type === 'object' (or 'orb' for XP) represents dropped items in Mineflayer
        const itemDrop = bot.nearestEntity(e => {
            return e.type === 'object' || e.type === 'orb';
        });

        if (itemDrop && bot.entity.position.distanceTo(itemDrop.position) < 20) {
             return {
                priority: 30, // Higher than grass breaking (20), lower than maintenance (50)
                description: `Picking up item at ${itemDrop.position.floored()}`,
                target: itemDrop,
                range: 1.0, 
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        // The movement is handled by the Role (range 1.0).
        // We just wait a brief moment to ensure pickup registration.
        await new Promise(r => setTimeout(r, 200));
    }
}