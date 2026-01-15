import type { Bot } from 'mineflayer';
import type { FarmingRole } from '../FarmingRole';
import type { Task, WorkProposal } from './Task';
import { goals } from 'mineflayer-pathfinder';

const { GoalLookAtBlock } = goals;

export class HarvestTask implements Task {
    name = 'harvest';

    async findWork(bot: Bot, role: FarmingRole): Promise<WorkProposal | null> {
        if (bot.inventory.emptySlotCount() < 1) return null;

        // Use farm center if known, otherwise bot position
        const farmAnchor = role.getNearestPOI(bot, 'farm_center')?.position || bot.entity.position;

        const block = bot.findBlock({
            point: farmAnchor,
            maxDistance: 32,
            matching: (b) => {
                // FIX: Check if block and position exist before accessing them
                if (!b || !b.position) return false;
                
                // Now safe to access properties
                if (role.failedBlocks.has(b.position.toString())) return false;
                
                return this.isMature(b);
            }
        });

        if (block) {
            return {
                priority: 10,
                description: `Harvesting ${block.name} at ${block.position}`,
                target: block,
                task: this
            };
        }
        return null;
    }

    async perform(bot: Bot, role: FarmingRole, target: any): Promise<void> {
        if (!target) return;
        
        try {
            // Move to the crop using GoalLookAtBlock (stops adjacent to block)
            await bot.pathfinder.goto(new GoalLookAtBlock(target.position, bot.world));
            
            // Break it
            await bot.dig(target);
            
            // Wait brief moment for drops
            await new Promise(resolve => setTimeout(resolve, 250));
        } catch (err) {
            role.log(`Failed to harvest: ${err}`);
            if (target && target.position) {
                role.blacklistBlock(target.position);
            }
        }
    }

    private isMature(block: any): boolean {
        if (!block) return false;
        const cropNames = ['wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart'];
        if (!cropNames.includes(block.name)) return false;

        const props = block.getProperties();
        if (props && props.age !== undefined) {
            const maxAge = block.name === 'beetroots' ? 3 : 7;
            return parseInt(props.age) >= maxAge;
        }
        
        // Fallback for metadata (older versions)
        return block.metadata >= 7;
    }
}