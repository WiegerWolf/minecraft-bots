import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements } from 'mineflayer-pathfinder';
import { createBlackboard, updateBlackboard, type FarmingBlackboard } from './Blackboard';
import { createFarmingBehaviorTree, type BehaviorNode } from './behaviors';
import { villageManager } from '../../shared/VillageState';

export class FarmingRole implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    private blackboard: FarmingBlackboard;
    private behaviorTree: BehaviorNode;
    private static processHandlersRegistered = false;

    constructor() {
        this.blackboard = createBlackboard();
        this.behaviorTree = createFarmingBehaviorTree();
    }

    start(bot: Bot, options?: { center?: any }) {
        if (this.active) return;
        this.active = true;
        this.bot = bot;

        // Configure pathfinder
        const movements = new Movements(bot);
        movements.canDig = true;
        movements.digCost = 10;
        bot.pathfinder.setMovements(movements);

        // Handle pathfinder errors that escape try/catch (event-based errors)
        bot.on('path_stop', () => {
            // Path stopped, this is normal
        });

        // Handle pathfinder goal_updated event which can throw
        bot.on('goal_updated' as any, () => {
            // Goal updated, this is normal when actions interrupt each other
        });

        // Suppress unhandled promise rejections (pathfinder often rejects promises)
        process.on('unhandledRejection', (reason: any) => {
            const message = reason?.message || String(reason);
            if (message.includes('goal was changed') ||
                message.includes('GoalChanged') ||
                message.includes('No path to the goal') ||
                message.includes('Path was stopped')) {
                // Normal pathfinder interruptions, ignore
                return;
            }
            console.error('[Farming] Unhandled rejection:', reason);
        });

        // Suppress unhandled exceptions
        process.on('uncaughtException', (err) => {
            if (err.message?.includes('goal was changed') ||
                err.name === 'GoalChanged' ||
                err.message?.includes('No path to the goal') ||
                err.message?.includes('Path was stopped')) {
                // Ignore pathfinder errors - these are normal when actions interrupt each other
                return;
            }
            // Ignore protocol errors from chat serialization (MC version issues)
            if (err.message?.includes('RangeError') || err.message?.includes('out of bounds')) {
                console.warn('[Farming] Protocol error (ignored):', err.message);
                return;
            }
            console.error('[Farming] Uncaught exception:', err);
        });

        // Initialize blackboard
        this.blackboard = createBlackboard();

        if (options?.center) {
            // Validate the provided center is actually water
            const centerPos = options.center;
            const block = bot.blockAt(centerPos);
            if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                this.blackboard.farmCenter = centerPos.clone ? centerPos.clone() : centerPos;
                console.log(`[Farming] Initial farm center set to water at ${this.blackboard.farmCenter}`);
            } else {
                console.log(`[Farming] ⚠️ Provided center is not water, will discover naturally`);
                // Don't set farm center - let bot discover it naturally
            }
        }

        // Check for existing village center and register bot
        this.initializeVillageIntegration(bot);

        console.log('[Farming] 🚜 Behavior Tree Farming Role started.');
        this.loop();
    }

    private async initializeVillageIntegration(bot: Bot) {
        try {
            // Check if village center already exists
            const existingCenter = await villageManager.getVillageCenter();
            if (existingCenter && !this.blackboard.farmCenter) {
                this.blackboard.farmCenter = existingCenter;
                console.log(`[Farming] Using existing village center at ${existingCenter}`);
            }

            // Register this bot with the village
            await villageManager.updateBot(bot.username, {
                role: 'farming',
                position: {
                    x: bot.entity.position.x,
                    y: bot.entity.position.y,
                    z: bot.entity.position.z
                },
                provides: ['wheat', 'wheat_seeds', 'carrot', 'potato', 'beetroot'],
                needs: this.blackboard.needsTools ? ['stick', 'planks'] : []
            });
        } catch (error) {
            console.warn('[Farming] Failed to initialize village integration:', error);
        }
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        bot.pathfinder.stop();
        console.log('[Farming] 🛑 Farming Role stopped.');
    }

    private async loop() {
        while (this.active && this.bot) {
            try {
                // ═══════════════════════════════════════════════
                // PHASE 1: PERCEIVE
                // ═══════════════════════════════════════════════
                updateBlackboard(this.bot, this.blackboard);

                // Update village state and log status every 10 seconds
                if (Date.now() % 10000 < 150) {
                    this.logStatus();
                    this.updateVillageState(this.bot);
                }

                // ═══════════════════════════════════════════════
                // PHASE 2: DECIDE & ACT
                // ═══════════════════════════════════════════════
                const status = await this.behaviorTree.tick(this.bot, this.blackboard);

                if (status === 'success') {
                    this.blackboard.consecutiveIdleTicks = 0;
                }

                // ═══════════════════════════════════════════════
                // PHASE 3: WAIT
                // ═══════════════════════════════════════════════
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error: unknown) {
                // Ignore common pathfinder errors - these happen when actions interrupt each other
                if (error instanceof Error) {
                    const msg = error.message || '';
                    if (msg.includes('goal was changed') ||
                        msg.includes('GoalChanged') ||
                        msg.includes('No path to the goal') ||
                        msg.includes('Path was stopped') ||
                        error.name === 'GoalChanged') {
                        // Normal interruption, continue immediately
                        continue;
                    }
                    // Protocol errors from chat - log but continue
                    if (msg.includes('RangeError') || msg.includes('out of bounds')) {
                        console.warn('[Farming] Protocol error (continuing):', msg);
                        continue;
                    }
                }
                console.error('[Farming] Loop error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async updateVillageState(bot: Bot) {
        try {
            // Register village center if we discovered one
            if (this.blackboard.farmCenter) {
                await villageManager.setVillageCenter(this.blackboard.farmCenter);
            }

            // Register shared chest if we have one
            if (this.blackboard.farmChest) {
                await villageManager.setSharedChest(this.blackboard.farmChest);
            }

            // Update bot state
            await villageManager.updateBot(bot.username, {
                role: 'farming',
                position: {
                    x: bot.entity.position.x,
                    y: bot.entity.position.y,
                    z: bot.entity.position.z
                },
                provides: ['wheat', 'wheat_seeds', 'carrot', 'potato', 'beetroot'],
                needs: this.blackboard.needsTools ? ['stick', 'planks'] : []
            });

            // Clean up stale requests
            await villageManager.cancelStaleRequests();
        } catch (error) {
            // Ignore errors - village state is optional
        }
    }

    private logStatus() {
        const bb = this.blackboard;
        console.log(`[Farming Status] Hoe:${bb.hasHoe} Seeds:${bb.seedCount} Produce:${bb.produceCount} Farmland:${bb.nearbyFarmland.length} Crops:${bb.nearbyMatureCrops.length} Water:${bb.nearbyWater.length} Center:${bb.farmCenter || 'none'} Chest:${bb.farmChest || 'none'}`);
        console.log(`[Farming Flags] canTill:${bb.canTill} canPlant:${bb.canPlant} canHarvest:${bb.canHarvest} needsSeeds:${bb.needsSeeds} needsTools:${bb.needsTools}`);
    }
}