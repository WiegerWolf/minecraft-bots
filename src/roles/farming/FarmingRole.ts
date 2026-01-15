import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
// ADD: Import Movements
import { goals, Movements } from 'mineflayer-pathfinder';
import { CraftingMixin } from '../mixins/CraftingMixin';
import { KnowledgeMixin } from '../mixins/KnowledgeMixin';
import type { Task, WorkProposal } from './tasks/Task';
import { HarvestTask } from './tasks/HarvestTask';
import { PlantTask } from './tasks/PlantTask';
import { LogisticsTask } from './tasks/LogisticsTask';
import { TillTask } from './tasks/TillTask';
import { MaintenanceTask } from './tasks/MaintenanceTask';

const { GoalNear } = goals;

export class FarmingRole extends CraftingMixin(KnowledgeMixin(class { })) implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    
    private tasks: Task[] = [];

    public failedBlocks: Map<string, number> = new Map();
    public containerCooldowns: Map<string, number> = new Map();
    public readonly RETRY_COOLDOWN = 5 * 60 * 1000;
    public readonly CONTAINER_COOLDOWN = 30 * 1000;
    
    private currentProposal: WorkProposal | null = null;
    private movementStartTime = 0;
    private readonly MOVEMENT_TIMEOUT = 20000;

    constructor() {
        super();
        this.tasks = [
            new MaintenanceTask(),
            new LogisticsTask(),
            new HarvestTask(),
            new PlantTask(),
            new TillTask(),
        ];
    }

    start(bot: Bot) {
        this.active = true;
        this.bot = bot;
        
        // --- FIX START: Configure Movements ---
        const defaultMove = new Movements(bot);
        defaultMove.canDig = false; // Don't break blocks while pathing (safer for farming)
        defaultMove.allow1by1towers = false; // Don't pillar up unnecessarily
        bot.pathfinder.setMovements(defaultMove);
        // --- FIX END ---

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

        if (this.currentProposal && this.currentProposal.target) {
            const dist = bot.entity.position.distanceTo(this.currentProposal.target.position);
            const reach = this.currentProposal.range || 3.5;

            if (Date.now() - this.movementStartTime > this.MOVEMENT_TIMEOUT) {
                this.log(`⚠️ Movement timed out for ${this.currentProposal.description}`);
                // Blacklist the position so we don't try it again immediately
                this.blacklistBlock(this.currentProposal.target.position);
                bot.pathfinder.setGoal(null);
                this.currentProposal = null;
                return;
            }

            if (dist <= reach) {
                bot.pathfinder.setGoal(null);
                
                try {
                    await this.currentProposal.task.perform(bot, this, this.currentProposal.target);
                } catch (error) {
                    this.log(`❌ Error executing ${this.currentProposal.description}:`, error);
                }
                
                this.currentProposal = null;
            }
            return;
        }

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
            // this.log(`⛔ Blacklisting ${pos.toString()}`);
            this.failedBlocks.set(pos.toString(), Date.now());
        }
    }

    public override log(message: string, ...args: any[]) {
        console.log(`[Farming] ${message}`, ...args);
    }
}