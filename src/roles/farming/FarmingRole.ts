import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { goals, Movements } from 'mineflayer-pathfinder';
import { CraftingMixin } from '../mixins/CraftingMixin';
import { KnowledgeMixin } from '../mixins/KnowledgeMixin';
import type { Task, WorkProposal } from './tasks/Task';
import { HarvestTask } from './tasks/HarvestTask.ts';
import { PlantTask } from './tasks/PlantTask.ts';
import { LogisticsTask } from './tasks/LogisticsTask.ts';
import { TillTask } from './tasks/TillTask.ts';
import { MaintenanceTask } from './tasks/MaintenanceTask.ts';

const { GoalNear } = goals;

export class FarmingRole extends CraftingMixin(KnowledgeMixin(class { })) implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    
    // The list of modular strategies
    private tasks: Task[] = [];

    // Shared State for Tasks
    public failedBlocks: Map<string, number> = new Map();
    public containerCooldowns: Map<string, number> = new Map();
    public readonly RETRY_COOLDOWN = 5 * 60 * 1000;    // 5 minutes
    
    // Movement tracking
    private currentProposal: WorkProposal | null = null;
    private movementStartTime = 0;
    private readonly MOVEMENT_TIMEOUT = 20000;

    constructor() {
        super();
        this.tasks = [
            new MaintenanceTask(), // High Prio
            new LogisticsTask(),   
            new HarvestTask(),     
            new PlantTask(),       
            new TillTask(),        
        ];
    }

    start(bot: Bot) {
        this.active = true;
        this.bot = bot;
        
        // Setup Movements
        const defaultMove = new Movements(bot);
        defaultMove.canDig = false; 
        defaultMove.allow1by1towers = false;
        bot.pathfinder.setMovements(defaultMove);
        
        // Reset state
        this.currentProposal = null;
        this.failedBlocks.clear();
        this.containerCooldowns.clear();
        
        this.log('🚜 Modular Farming Role started.');
        bot.chat('🚜 Farming started (Modular).');
        
        const existingFarm = bot.findBlock({ matching: b => b.name === 'farmland', maxDistance: 32 });
        if (existingFarm) this.rememberPOI('farm_center', existingFarm.position);
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        this.currentProposal = null;
        bot.pathfinder.setGoal(null);
        this.log('🛑 Farming Role stopped.');
    }

    async update(bot: Bot) {
        if (!this.active) return;

        // 1. If we are currently executing a proposal (Moving), check status
        if (this.currentProposal && this.currentProposal.target) {
            const dist = bot.entity.position.distanceTo(this.currentProposal.target.position);
            const reach = this.currentProposal.range || 3.5;

            // Timeout Check
            if (Date.now() - this.movementStartTime > this.MOVEMENT_TIMEOUT) {
                this.log(`⚠️ Movement timed out for ${this.currentProposal.description}`);
                this.blacklistBlock(this.currentProposal.target.position);
                bot.pathfinder.setGoal(null);
                this.currentProposal = null;
                return;
            }

            // Arrived?
            if (dist <= reach) {
                // STOP moving
                bot.pathfinder.setGoal(null);
                bot.clearControlStates(); // Stop physics immediately
                
                // Execute the specific task logic
                try {
                    await this.currentProposal.task.perform(bot, this, this.currentProposal.target);
                } catch (error) {
                    this.log(`❌ Error executing ${this.currentProposal.description}:`, error);
                    // IMPORTANT: Blacklist block if action fails
                    if (this.currentProposal.target?.position) {
                        this.blacklistBlock(this.currentProposal.target.position);
                    }
                }
                
                this.currentProposal = null;
            }
            return; // Busy moving/acting
        }

        // 2. Find new work
        let bestProposal: WorkProposal | null = null;

        for (const task of this.tasks) {
            try {
                const proposal = await task.findWork(bot, this);
                if (!proposal) continue;

                if (proposal.priority >= 100) {
                    bestProposal = proposal;
                    break;
                }

                if (!bestProposal || proposal.priority > bestProposal.priority) {
                    bestProposal = proposal;
                }
            } catch (err) {
                console.error(`Error in task ${task.name}:`, err);
            }
        }

        // 3. Act on best proposal
        if (bestProposal) {
            this.log(`📋 Selected: ${bestProposal.description} (Prio: ${bestProposal.priority})`);
            this.currentProposal = bestProposal;
            
            if (bestProposal.target) {
                this.movementStartTime = Date.now();
                const pos = bestProposal.target.position;
                const range = bestProposal.range || 3.5;
                bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, range));
            } else {
                await bestProposal.task.perform(bot, this);
                this.currentProposal = null;
            }
        }
    }

    public blacklistBlock(pos: any) {
        if (pos && pos.toString) {
            const key = pos.toString();
            this.log(`⛔ Blacklisting position: ${key}`);
            this.failedBlocks.set(key, Date.now());
        }
    }

    public override log(message: string, ...args: any[]) {
        console.log(`[Farming] ${message}`, ...args);
    }
}