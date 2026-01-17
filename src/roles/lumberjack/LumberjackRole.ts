import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements } from 'mineflayer-pathfinder';
import { createLumberjackBlackboard, updateLumberjackBlackboard, type LumberjackBlackboard } from './LumberjackBlackboard';
import { createLumberjackBehaviorTree, type BehaviorNode } from './behaviors';
import { VillageChat } from '../../shared/VillageChat';

export class LumberjackRole implements Role {
    name = 'lumberjack';
    private active = false;
    private bot: Bot | null = null;
    private blackboard: LumberjackBlackboard;
    private behaviorTree: BehaviorNode;
    private villageChat: VillageChat | null = null;

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

        // Initialize chat-based village communication
        this.villageChat = new VillageChat(bot);
        this.blackboard.villageChat = this.villageChat;

        console.log('[Lumberjack] Lumberjack Role started.');
        this.loop();
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        bot.pathfinder.stop();
        console.log('[Lumberjack] Lumberjack Role stopped.');
    }

    private isBotConnected(): boolean {
        if (!this.bot) return false;
        try {
            const client = (this.bot as any)._client;
            if (!client || !client.socket || client.socket.destroyed) {
                return false;
            }
            if (!this.bot.entity) return false;
            return true;
        } catch {
            return false;
        }
    }

    private async loop() {
        while (this.active && this.bot) {
            // Check for zombie state
            if (!this.isBotConnected()) {
                console.error('[Lumberjack] Connection lost - stopping role');
                this.active = false;
                break;
            }

            try {
                // ═══════════════════════════════════════════════
                // PHASE 1: PERCEIVE
                // ═══════════════════════════════════════════════
                await updateLumberjackBlackboard(this.bot, this.blackboard);

                // Clean up old requests periodically
                if (this.villageChat) {
                    this.villageChat.cleanupOldRequests();
                }

                // Log status every 10 seconds
                if (Date.now() % 10000 < 150) {
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
        console.log(`[Lumberjack Status] Axe:${bb.hasAxe} Logs:${bb.logCount} Planks:${bb.plankCount} Sticks:${bb.stickCount} Trees:${bb.nearbyTrees.length} Village:${bb.villageCenter || 'none'} Requests:${bb.hasPendingRequests}`);
    }
}
