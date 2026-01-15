import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { goals, Movements } from 'mineflayer-pathfinder';
import { CraftingMixin } from '../mixins/CraftingMixin';
import { KnowledgeMixin } from '../mixins/KnowledgeMixin';
import type { Task, WorkProposal } from './tasks/Task';
import { HarvestTask } from './tasks/HarvestTask';
import { PlantTask } from './tasks/PlantTask';
import { LogisticsTask } from './tasks/LogisticsTask';
import { TillTask } from './tasks/TillTask';
import { MaintenanceTask } from './tasks/MaintenanceTask';

const { GoalNear, GoalXZ } = goals;

export class FarmingRole extends CraftingMixin(KnowledgeMixin(class { })) implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    
    private tasks: Task[] = [];
    public failedBlocks: Map<string, number> = new Map();
    public containerCooldowns: Map<string, number> = new Map();
    public readonly RETRY_COOLDOWN = 5 * 60 * 1000;
    
    private currentProposal: WorkProposal | null = null;
    private movementStartTime = 0;
    private readonly MOVEMENT_TIMEOUT = 20000;
    
    private idleTicks = 0;

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

    start(bot: Bot, options?: { center?: any }) {
        this.active = true;
        this.bot = bot;
        
        const defaultMove = new Movements(bot);
        defaultMove.canDig = false; 
        defaultMove.allow1by1towers = false;
        (defaultMove as any).liquidCost = 1; 
        
        bot.pathfinder.setMovements(defaultMove);
        
        this.currentProposal = null;
        this.failedBlocks.clear();
        this.containerCooldowns.clear();
        this.idleTicks = 0;
        
        this.log('🚜 Modular Farming Role started.');
        
        // Set farm center
        if (options?.center) {
            this.rememberPOI('farm_center', options.center);
            this.log(`📍 Farm center set to ${options.center}`);
        } else {
            const existingFarm = bot.findBlock({ matching: b => b.name === 'farmland', maxDistance: 32 });
            if (existingFarm) {
                this.rememberPOI('farm_center', existingFarm.position);
            } else {
                this.rememberPOI('farm_center', bot.entity.position);
            }
        }
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

        // 0. Enforce Proximity to Farm Center
        // If we are wandering too far and have no critical work, move back.
        const centerPOI = this.getNearestPOI(bot, 'farm_center');
        if (centerPOI && !this.currentProposal) {
            const dist = bot.entity.position.distanceTo(centerPOI.position);
            if (dist > 40) {
                this.log("🏃 Returning to farm center...");
                bot.pathfinder.setGoal(new GoalNear(centerPOI.position.x, centerPOI.position.y, centerPOI.position.z, 2));
                return;
            }
        }

        // 1. Moving/Executing Current Proposal
        if (this.currentProposal && this.currentProposal.target) {
            const dist = bot.entity.position.distanceTo(this.currentProposal.target.position);
            const reach = this.currentProposal.range || 3.5;

            if (Date.now() - this.movementStartTime > this.MOVEMENT_TIMEOUT) {
                this.log(`⚠️ Movement timed out for ${this.currentProposal.description}`);
                this.blacklistBlock(this.currentProposal.target.position);
                bot.pathfinder.setGoal(null);
                this.currentProposal = null;
                return;
            }

            if (dist <= reach) {
                bot.pathfinder.setGoal(null);
                bot.clearControlStates();
                
                try {
                    await this.currentProposal.task.perform(bot, this, this.currentProposal.target);
                } catch (error) {
                    this.log(`❌ Error executing ${this.currentProposal.description}:`, error);
                    if (this.currentProposal.target?.position) {
                        this.blacklistBlock(this.currentProposal.target.position);
                    }
                }
                
                this.currentProposal = null;
            }
            return;
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

        // 3. Act
        if (bestProposal) {
            this.idleTicks = 0;
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
        } else {
            // Idle handling
            this.idleTicks++;
            const isInventoryEmpty = bot.inventory.items().length === 0;
            const wanderThreshold = isInventoryEmpty ? 10 : 120; // Wander fast if empty (5s vs 60s)

            if (this.idleTicks % 40 === 0) {
                this.printDebugInventory(bot);
            }
            
            if (this.idleTicks > wanderThreshold) {
                this.log(isInventoryEmpty ? "🏃 Searching for resources..." : "🚶 Wandering...");
                this.idleTicks = 0;
                
                // Wander randomly
                const x = bot.entity.position.x + (Math.random() * 40 - 20);
                const z = bot.entity.position.z + (Math.random() * 40 - 20);
                bot.pathfinder.setGoal(new GoalNear(x, bot.entity.position.y, z, 1));
                
                // Set a dummy proposal so we don't spam new goals while moving
                this.currentProposal = {
                    priority: 1,
                    description: "Wandering",
                    target: { position: { x, y: bot.entity.position.y, z } },
                    range: 2,
                    task: { 
                        name: 'wander',
                        findWork: async () => null,
                        perform: async () => { this.log("Finished wandering."); }
                    }
                };
                this.movementStartTime = Date.now();
            }
        }
    }

    private printDebugInventory(bot: Bot) {
        const items = bot.inventory.items().map(i => `${i.name} x${i.count}`).join(', ');
        this.log(`💤 No work found. Inv: [${items || 'Empty'}]`);
    }

    public blacklistBlock(pos: any) {
        if (pos && pos.toString) {
            const key = pos.toString();
            // this.log(`⛔ Blacklisting position: ${key}`);
            this.failedBlocks.set(key, Date.now());
        }
    }

    public override log(message: string, ...args: any[]) {
        console.log(`[Farming] ${message}`, ...args);
    }
}