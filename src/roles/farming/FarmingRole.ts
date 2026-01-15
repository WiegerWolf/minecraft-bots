import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements, goals } from 'mineflayer-pathfinder';
import { CraftingMixin } from '../mixins/CraftingMixin';
import { KnowledgeMixin } from '../mixins/KnowledgeMixin';
import { ResourceMixin } from '../mixins/ResourceMixin';
import type { Task, WorkProposal } from './tasks/Task';
import { HarvestTask } from './tasks/HarvestTask';
import { PlantTask } from './tasks/PlantTask';
import { LogisticsTask } from './tasks/LogisticsTask';
import { TillTask } from './tasks/TillTask';
import { MaintenanceTask } from './tasks/MaintenanceTask';
import { PickupTask } from './tasks/PickupTask';
import { Vec3 } from 'vec3'; // ADD THIS IMPORT

const { GoalNear } = goals;

export class FarmingRole extends ResourceMixin(CraftingMixin(KnowledgeMixin(class { }))) implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    private tasks: Task[] = [];
    
    // State
    public failedBlocks: Map<string, number> = new Map();
    public containerCooldowns: Map<string, number> = new Map();

    constructor() {
        super();
        this.tasks = [
            new PickupTask(),
            new MaintenanceTask(),
            new LogisticsTask(),
            new HarvestTask(),
            new PlantTask(),
            new TillTask(),
        ];
    }

    start(bot: Bot, options?: { center?: any }) {
        if (this.active) return;
        this.active = true;
        this.bot = bot;

        const defaultMove = new Movements(bot);
        defaultMove.canDig = true;
        defaultMove.digCost = 10;
        defaultMove.allow1by1towers = true;
        (defaultMove as any).liquidCost = 5; 
        bot.pathfinder.setMovements(defaultMove);

        this.failedBlocks.clear();
        this.containerCooldowns.clear();

        if (options?.center) {
            this.rememberPOI('farm_center', options.center);
        } else {
            this.rememberPOI('farm_center', bot.entity.position.clone());
        }

        this.log('🚜 Modular Farming Role started.');
        this.loop();
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        bot.pathfinder.stop();
        bot.pathfinder.setGoal(null);
        this.log('🛑 Farming Role stopped.');
    }

    private async loop() {
        while (this.active && this.bot) {
            try {
                const proposal = await this.findBestProposal();

                if (proposal) {
                    this.log(`📋 Executing: ${proposal.description}`);
                    await proposal.task.perform(this.bot, this, proposal.target);
                } else {
                    await this.idle(this.bot);
                }

                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error('[Farming Loop Error]', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async findBestProposal(): Promise<WorkProposal | null> {
        if (!this.bot) return null;
        
        let bestProposal: WorkProposal | null = null;

        for (const task of this.tasks) {
            try {
                const proposal = await task.findWork(this.bot, this);
                if (!proposal) continue;

                if (proposal.priority >= 100) return proposal;

                if (!bestProposal || proposal.priority > bestProposal.priority) {
                    bestProposal = proposal;
                }
            } catch (err) {
                console.error(`Error in task scan ${task.name}:`, err);
            }
        }
        return bestProposal;
    }

    private async idle(bot: Bot) {
        this.log("💤 No immediate work. Exploring for resources...");
        const moved = await this.wanderNewChunk(bot);
        if (!moved) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // NEW METHOD: Manually breaks blocks causing the bot to be stuck
    public async clearObstructions(bot: Bot) {
        this.log("⚠️ Detected stuck/obstruction. Clearing surroundings...");
        
        // Check Head, Feet, and adjacent head-level blocks
        const offsets = [
            new Vec3(0, 1, 0), // Head (Leaves often here)
            new Vec3(0, 2, 0), // Jump space
            new Vec3(0, 0, 0), // Feet (clipped inside block)
            new Vec3(1, 1, 0),
            new Vec3(-1, 1, 0),
            new Vec3(0, 1, 1),
            new Vec3(0, 1, -1),
        ];

        for (const offset of offsets) {
            const target = bot.entity.position.plus(offset).floored();
            const block = bot.blockAt(target);
            
            // Break if it's solid/leaves and we can dig it
            if (block && block.boundingBox !== 'empty' && block.diggable) {
                 // Safety: Don't break valuable blocks
                 if (['chest', 'crafting_table', 'furnace', 'bed', 'hopper'].includes(block.name)) continue;
                 
                 this.log(`🔨 Breaking obstructing ${block.name} at ${target}`);
                 try {
                     await bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
                     await bot.dig(block);
                     await new Promise(r => setTimeout(r, 250)); // Wait for physics
                 } catch (e) {
                     // Ignore errors (e.g. if block broke while looking)
                 }
            }
        }
    }

    public blacklistBlock(pos: any) {
        if (!pos) return;
        let key = pos.floored ? pos.floored().toString() : String(pos);
        this.failedBlocks.set(key, Date.now());
        this.log(`⛔ Blacklisted block at ${key}`);
    }

    public override log(message: string, ...args: any[]) {
        console.log(`[Farming] ${message}`, ...args);
    }
}