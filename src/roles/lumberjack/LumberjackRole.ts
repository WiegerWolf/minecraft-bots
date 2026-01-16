import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements } from 'mineflayer-pathfinder';
import { createLumberjackBlackboard, updateLumberjackBlackboard, type LumberjackBlackboard } from './LumberjackBlackboard';
import { createLumberjackBehaviorTree, type BehaviorNode } from './behaviors';
import { villageManager } from '../../shared/VillageState';

export class LumberjackRole implements Role {
    name = 'lumberjack';
    private active = false;
    private bot: Bot | null = null;
    private blackboard: LumberjackBlackboard;
    private behaviorTree: BehaviorNode;

    constructor() {
        this.blackboard = createLumberjackBlackboard();
        this.behaviorTree = createLumberjackBehaviorTree();
    }

    start(bot: Bot, options?: any) {
        if (this.active) return;
        this.active = true;
        this.bot = bot;

        // Configure pathfinder
        const movements = new Movements(bot);
        movements.canDig = true;
        movements.digCost = 10;
        bot.pathfinder.setMovements(movements);

        // Handle pathfinder errors
        bot.on('path_stop', () => {
            // Path stopped, normal
        });

        bot.on('goal_updated' as any, () => {
            // Goal updated, normal when actions interrupt
        });

        // Suppress unhandled promise rejections
        process.on('unhandledRejection', (reason: any) => {
            const message = reason?.message || String(reason);
            if (message.includes('goal was changed') ||
                message.includes('GoalChanged') ||
                message.includes('No path to the goal') ||
                message.includes('Path was stopped')) {
                return;
            }
            console.error('[Lumberjack] Unhandled rejection:', reason);
        });

        // Suppress unhandled exceptions
        process.on('uncaughtException', (err) => {
            if (err.message?.includes('goal was changed') ||
                err.name === 'GoalChanged' ||
                err.message?.includes('No path to the goal') ||
                err.message?.includes('Path was stopped')) {
                return;
            }
            if (err.message?.includes('RangeError') || err.message?.includes('out of bounds')) {
                console.warn('[Lumberjack] Protocol error (ignored):', err.message);
                return;
            }
            console.error('[Lumberjack] Uncaught exception:', err);
        });

        // Initialize blackboard
        this.blackboard = createLumberjackBlackboard();

        // Register bot with village manager
        this.registerWithVillage(bot);

        console.log('[Lumberjack] 🪓 Lumberjack Role started.');
        this.loop();
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        bot.pathfinder.stop();
        console.log('[Lumberjack] 🛑 Lumberjack Role stopped.');
    }

    private async registerWithVillage(bot: Bot) {
        try {
            await villageManager.updateBot(bot.username, {
                role: 'lumberjack',
                position: {
                    x: bot.entity.position.x,
                    y: bot.entity.position.y,
                    z: bot.entity.position.z
                },
                provides: ['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'birch_planks', 'spruce_planks', 'stick', 'oak_sapling'],
                needs: []
            });
        } catch (error) {
            console.warn('[Lumberjack] Failed to register with village:', error);
        }
    }

    private async loop() {
        while (this.active && this.bot) {
            try {
                // ═══════════════════════════════════════════════
                // PHASE 1: PERCEIVE
                // ═══════════════════════════════════════════════
                await updateLumberjackBlackboard(this.bot, this.blackboard);

                // Update position in village state periodically
                if (Date.now() % 10000 < 150) {
                    this.registerWithVillage(this.bot);
                    this.logStatus();
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
                if (error instanceof Error) {
                    const msg = error.message || '';
                    if (msg.includes('goal was changed') ||
                        msg.includes('GoalChanged') ||
                        msg.includes('No path to the goal') ||
                        msg.includes('Path was stopped') ||
                        error.name === 'GoalChanged') {
                        continue;
                    }
                    if (msg.includes('RangeError') || msg.includes('out of bounds')) {
                        console.warn('[Lumberjack] Protocol error (continuing):', msg);
                        continue;
                    }
                }
                console.error('[Lumberjack] Loop error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private logStatus() {
        const bb = this.blackboard;
        console.log(`[Lumberjack Status] Axe:${bb.hasAxe} Logs:${bb.logCount} Planks:${bb.plankCount} Sticks:${bb.stickCount} Trees:${bb.nearbyTrees.length} Village:${bb.villageCenter || 'none'}`);
        console.log(`[Lumberjack Flags] canChop:${bb.canChop} needsDeposit:${bb.needsToDeposit} pendingRequests:${bb.hasPendingRequests}`);
    }
}
