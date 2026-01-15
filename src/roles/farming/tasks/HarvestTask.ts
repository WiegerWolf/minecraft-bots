import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';

export class HarvestTask implements Task {
    name = 'harvest';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        // 1. Don't harvest if inventory is full (Logistics will handle deposit)
        if (bot.inventory.emptySlotCount() < 1) return null;

        // 2. Find mature crops
        // Prioritize crops near the farm center if known
        const farmAnchor = role.getNearestPOI(bot, 'farm_center');
        const point = farmAnchor ? farmAnchor.position : bot.entity.position;

        const block = bot.findBlock({
            point,
            maxDistance: 32,
            matching: (b) => {
                // Filter out blacklisted blocks
                if (role.failedBlocks.has(b.position.toString())) return false;
                return this.isMature(b);
            }
        });

        if (block) {
            return {
                priority: 10,
                description: `Harvesting ${block.name}`,
                target: block,
                range: 3.5,
                task: this
            };
        }

        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;
        
        role.log(`Digging ${target.name}...`);
        await bot.dig(target);
        
        // Simple pickup logic: wait a moment for items to drop/merge
        // (A dedicated CollectionTask is better, but this works for now)
        const item = bot.nearestEntity(e => e.name === 'item' && e.position.distanceTo(target.position) < 3);
        if (item) {
             // We are likely close enough to pick it up automatically due to GoalNear
        }
    }

    private isMature(block: any): boolean {
        if (!block) return false;
        const cropNames = ['wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart'];
        if (!cropNames.includes(block.name)) return false;

        // Modern versions use properties, older use metadata
        const props = block.getProperties();
        if (props && props.age !== undefined) {
            const maxAge = block.name === 'beetroots' ? 3 : 7;
            return parseInt(props.age) >= maxAge;
        }
        
        // Fallback
        return block.metadata >= 7;
    }
}