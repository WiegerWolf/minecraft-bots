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
import { PickupTask } from './tasks/PickupTask';

const { GoalNear } = goals;

export class FarmingRole extends CraftingMixin(KnowledgeMixin(class { })) implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;

    private tasks: Task[] = [];
    public failedBlocks: Map<string, number> = new Map();
    // LESSON: Add Container Cooldowns to prevent opening empty chests repeatedly
    public containerCooldowns: Map<string, number> = new Map();

    private currentProposal: WorkProposal | null = null;
    private movementStartTime = 0;
    private readonly MOVEMENT_TIMEOUT = 20000;

    private isWorking = false;
    private idleTicks = 0;

    // LESSON: Bind handlers to class to allow removal
    private boundOnPathUpdate: ((r: any) => void) | null = null;
    private boundOnGoalReached: (() => void) | null = null;

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
        this.active = true;
        this.bot = bot;

        // Setup Movements (Keep your improved settings)
        const defaultMove = new Movements(bot);
        defaultMove.canDig = true;
        defaultMove.digCost = 10;
        defaultMove.allow1by1towers = true;
        (defaultMove as any).liquidCost = 5;
        bot.pathfinder.setMovements(defaultMove);

        // LESSON: Bind Pathfinding Events for faster failure detection
        this.boundOnPathUpdate = (r: any) => {
            if (r.status === 'noPath' || r.status === 'timeout') {
                if (this.currentProposal?.target) {
                    this.log(`❌ Path failed to ${this.currentProposal.description}. Blacklisting.`);
                    this.blacklistBlock(this.currentProposal.target.position);
                    this.currentProposal = null;
                    bot.pathfinder.setGoal(null);
                }
            }
        };

        this.boundOnGoalReached = () => {
            // LESSON: If we reach the goal, force an update immediately to act
            if (this.currentProposal && this.active) {
                this.update(bot);
            }
        };

        bot.on('path_update', this.boundOnPathUpdate);
        bot.on('goal_reached', this.boundOnGoalReached);

        this.currentProposal = null;
        this.failedBlocks.clear();
        this.containerCooldowns.clear();
        this.isWorking = false;

        this.log('🚜 Modular Farming Role started.');

        if (options?.center) {
            this.rememberPOI('farm_center', options.center);
        } else {
            const existingFarm = bot.findBlock({ matching: b => b.name === 'farmland', maxDistance: 32 });
            if (existingFarm) this.rememberPOI('farm_center', existingFarm.position);
            else this.rememberPOI('farm_center', bot.entity.position);
        }
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        this.currentProposal = null;
        this.isWorking = false;

        // Cleanup listeners
        if (this.boundOnPathUpdate) bot.removeListener('path_update', this.boundOnPathUpdate);
        if (this.boundOnGoalReached) bot.removeListener('goal_reached', this.boundOnGoalReached);

        bot.pathfinder.setGoal(null);
        this.log('🛑 Farming Role stopped.');
    }

    async update(bot: Bot) {
        if (!this.active || this.isWorking) return;
        this.isWorking = true;

        try {
            // 1. Moving/Executing
            if (this.currentProposal && this.currentProposal.target) {
                const targetPos = this.currentProposal.target.position;
                const dist = bot.entity.position.distanceTo(targetPos);
                const reach = this.currentProposal.range || 3.5;

                // LESSON: Check if block invalid (e.g., dirt turned to grass while moving)
                // This prevents trying to interact with a block that changed state
                const currentBlock = bot.blockAt(targetPos);
                if (currentBlock && currentBlock.type !== this.currentProposal.target.type) {
                    // Allow slight leeway for crops growing, but not block replacement
                    if (this.currentProposal.task.name !== 'harvest') {
                        this.log(`⚠️ Block changed while moving. Aborting.`);
                        this.currentProposal = null;
                        bot.pathfinder.setGoal(null);
                        return;
                    }
                }

                if (dist <= reach) {
                    bot.pathfinder.setGoal(null);
                    bot.clearControlStates();

                    try {
                        await this.currentProposal.task.perform(bot, this, this.currentProposal.target);
                    } catch (error) {
                        this.log(`❌ Error executing ${this.currentProposal.description}:`, error);
                        this.blacklistBlock(targetPos);
                    }
                    this.currentProposal = null;
                    return; // Return to allow re-evaluating priorities
                }

                if (Date.now() - this.movementStartTime > this.MOVEMENT_TIMEOUT) {
                    this.log(`⚠️ Movement timed out.`);
                    this.blacklistBlock(targetPos);
                    bot.pathfinder.setGoal(null);
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

                    // Critical actions take immediate precedence
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
                this.log(`📋 Selected: ${bestProposal.description} (Prio: ${bestProposal.priority})`);
                this.currentProposal = bestProposal;

                if (bestProposal.target) {
                    const pos = bestProposal.target.position;
                    const reach = bestProposal.range || 3.5;

                    // LESSON: Optimization - If already close, don't pathfind, just loop back to perform
                    if (bot.entity.position.distanceTo(pos) <= reach) {
                        this.movementStartTime = Date.now(); // Reset timer for action phase
                        // Let the next loop iteration handle execution via the 'dist <= reach' check
                    } else {
                        this.movementStartTime = Date.now();
                        bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, reach));
                    }
                } else {
                    await bestProposal.task.perform(bot, this);
                    this.currentProposal = null;
                }
            } else {
                this.idleTicks++;
                const isInventoryEmpty = bot.inventory.items().length === 0;
                const wanderThreshold = isInventoryEmpty ? 20 : 120;

                if (this.idleTicks >= wanderThreshold) {
                    this.log(isInventoryEmpty ? "🏃 Searching/Wandering..." : "🚶 Wandering...");
                    this.idleTicks = 0;

                    const range = 16; // Reduced range to keep closer to farm
                    const x = bot.entity.position.x + (Math.random() * range - (range / 2));
                    const z = bot.entity.position.z + (Math.random() * range - (range / 2));
                    bot.pathfinder.setGoal(new GoalNear(x, bot.entity.position.y, z, 1));

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
        } finally {
            this.isWorking = false;
        }
    }

    private scanSurroundings(bot: Bot) {
        this.log("🔍 DEBUG: Scanning nearby blocks (Radius 16):");
        const counts: Record<string, number> = {};
        const pos = bot.entity.position;
        const radius = 16;
        for (let x = -radius; x <= radius; x += 2) {
            for (let y = -2; y <= 6; y++) {
                for (let z = -radius; z <= radius; z += 2) {
                    const block = bot.blockAt(pos.offset(x, y, z));
                    if (block && !['air', 'cave_air', 'water', 'grass_block', 'sand', 'dirt', 'stone'].includes(block.name)) {
                        counts[block.name] = (counts[block.name] || 0) + 1;
                    }
                }
            }
        }
        const summary = Object.entries(counts)
            .sort((a, b) => b[1] - a[1]).slice(0, 15)
            .map(([name, count]) => `${name}: ${count}`).join(', ');
        this.log(`Interesting blocks: [${summary || 'None'}]`);
    }

    public blacklistBlock(pos: any) {
        if (!pos) return;
        let key = pos.floored ? pos.floored().toString() : String(pos);
        this.failedBlocks.set(key, Date.now());
    }

    public override log(message: string, ...args: any[]) {
        console.log(`[Farming] ${message}`, ...args);
    }
}