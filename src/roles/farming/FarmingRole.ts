import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements, goals } from 'mineflayer-pathfinder';
import { CraftingMixin } from '../mixins/CraftingMixin';
import { KnowledgeMixin } from '../mixins/KnowledgeMixin';
import type { Task, WorkProposal } from './tasks/Task';
import { HarvestTask } from './tasks/HarvestTask';
import { PlantTask } from './tasks/PlantTask';
import { LogisticsTask } from './tasks/LogisticsTask';
import { TillTask } from './tasks/TillTask';
import { MaintenanceTask } from './tasks/MaintenanceTask';
import { PickupTask } from './tasks/PickupTask';

const { GoalNear } = goals;

export class FarmingRole extends CraftingMixin(KnowledgeMixin(class { })) implements Role {
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
        if (this.active) return; // Already running
        this.active = true;
        this.bot = bot;

        // Configure Movements
        const defaultMove = new Movements(bot);
        defaultMove.canDig = true;
        defaultMove.digCost = 10;
        defaultMove.allow1by1towers = true;
        (defaultMove as any).liquidCost = 5;
        bot.pathfinder.setMovements(defaultMove);

        // Reset state
        this.failedBlocks.clear();
        this.containerCooldowns.clear();

        if (options?.center) {
            this.rememberPOI('farm_center', options.center);
        } else {
            // Default to current location if not set
            this.rememberPOI('farm_center', bot.entity.position.clone());
        }

        this.log('🚜 Modular Farming Role started (Async Event-Driven).');
        
        // Start the loop
        this.loop();
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        bot.pathfinder.stop();
        bot.pathfinder.setGoal(null);
        this.log('🛑 Farming Role stopped.');
    }

    // The main "Brain" loop
    private async loop() {
        while (this.active && this.bot) {
            try {
                // 1. Find the best work
                const proposal = await this.findBestProposal();

                if (proposal) {
                    this.log(`📋 Executing: ${proposal.description}`);
                    
                    // 2. Execute the work (Includes movement AND action)
                    // The task is responsible for handling pathfinder.goto()
                    await proposal.task.perform(this.bot, this, proposal.target);
                    
                } else {
                    // 3. No work? Idle/Wander
                    await this.idle(this.bot);
                }

                // Short breathing room between tasks (prevents CPU spam if tasks return immediately)
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error('[Farming Loop Error]', error);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Safety backoff
            }
        }
    }

    private async findBestProposal(): Promise<WorkProposal | null> {
        if (!this.bot) return null;
        
        let bestProposal: WorkProposal | null = null;

        // Shuffle tasks slightly to prevent deterministic loops on tie-breaks? 
        // Or keep strict order. Keeping strict order for now.
        for (const task of this.tasks) {
            try {
                const proposal = await task.findWork(this.bot, this);
                if (!proposal) continue;

                // Critical priority short-circuit
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
        // Only wander if inventory is empty-ish, otherwise we might just be waiting for a crop to grow
        this.log("💤 No immediate work. Wandering briefly...");
        
        const range = 10;
        const x = bot.entity.position.x + (Math.random() * range - (range / 2));
        const z = bot.entity.position.z + (Math.random() * range - (range / 2));
        
        try {
            // We use 'goto' here, which waits for the event 'goal_reached'
            await bot.pathfinder.goto(new GoalNear(x, bot.entity.position.y, z, 1));
        } catch (err) {
            // It's fine if wandering fails
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