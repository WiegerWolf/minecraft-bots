import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements } from 'mineflayer-pathfinder';
import { createBlackboard, updateBlackboard, type FarmingBlackboard } from './Blackboard';
import { createFarmingBehaviorTree, type BehaviorNode } from './behaviors';
import { VillageChat } from '../../shared/VillageChat';

export class FarmingRole implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    private blackboard: FarmingBlackboard;
    private behaviorTree: BehaviorNode;
    private villageChat: VillageChat | null = null;

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

        // Initialize chat-based village communication
        this.villageChat = new VillageChat(bot);
        this.blackboard.villageChat = this.villageChat;

        if (options?.center) {
            // Validate the provided center is actually water
            const centerPos = options.center;
            const block = bot.blockAt(centerPos);
            if (block && (block.name === 'water' || block.name === 'flowing_water')) {
                this.blackboard.farmCenter = centerPos.clone ? centerPos.clone() : centerPos;
                console.log(`[Farming] Initial farm center set to water at ${this.blackboard.farmCenter}`);
            } else {
                console.log(`[Farming] Provided center is not water, will discover naturally`);
            }
        }

        console.log('[Farming] Behavior Tree Farming Role started.');
        this.loop();
    }

    stop(bot: Bot) {
        this.active = false;
        this.bot = null;
        bot.pathfinder.stop();
        console.log('[Farming] Farming Role stopped.');
    }

    private async loop() {
        while (this.active && this.bot) {
            try {
                // ═══════════════════════════════════════════════
                // PHASE 1: PERCEIVE
                // ═══════════════════════════════════════════════
                updateBlackboard(this.bot, this.blackboard);

                // Sync village chat state to blackboard
                if (this.villageChat) {
                    const chatCenter = this.villageChat.getVillageCenter();
                    if (chatCenter && !this.blackboard.farmCenter) {
                        this.blackboard.farmCenter = chatCenter;
                        console.log(`[Farming] Learned village center from chat: ${chatCenter}`);
                    }

                    const sharedChest = this.villageChat.getSharedChest();
                    if (sharedChest && !this.blackboard.farmChest) {
                        this.blackboard.farmChest = sharedChest;
                    }

                    // Clean up old requests periodically
                    this.villageChat.cleanupOldRequests();
                }

                // Log status every 10 seconds
                if (Date.now() % 10000 < 150) {
                    this.logStatus();

                    // Announce village center if we have one and haven't shared it
                    if (this.blackboard.farmCenter && this.villageChat) {
                        this.villageChat.announceVillageCenter(this.blackboard.farmCenter);
                    }
                    // Announce shared chest
                    if (this.blackboard.farmChest && this.villageChat) {
                        this.villageChat.announceSharedChest(this.blackboard.farmChest);
                    }
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

    private logStatus() {
        const bb = this.blackboard;
        console.log(`[Farming Status] Hoe:${bb.hasHoe} Seeds:${bb.seedCount} Produce:${bb.produceCount} Farmland:${bb.nearbyFarmland.length} Crops:${bb.nearbyMatureCrops.length} Water:${bb.nearbyWater.length} Center:${bb.farmCenter || 'none'} Chest:${bb.farmChest || 'none'}`);
    }
}
