import type { Bot } from 'mineflayer';
import type { Role } from '../Role';
import { Movements } from 'mineflayer-pathfinder';
import { createBlackboard, updateBlackboard, type FarmingBlackboard } from './Blackboard';
import { createFarmingBehaviorTree, type BehaviorNode } from './BehaviorTree';

export class FarmingRole implements Role {
    name = 'farming';
    private active = false;
    private bot: Bot | null = null;
    private blackboard: FarmingBlackboard;
    private behaviorTree: BehaviorNode;

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

        // Initialize blackboard
        this.blackboard = createBlackboard();
        
        if (options?.center) {
            // Validate the provided center
            const centerPos = options.center;
            if (centerPos.y > -60 && centerPos.y < 320) { // Sane Y range
                this.blackboard.farmCenter = centerPos.clone ? centerPos.clone() : centerPos;
                console.log(`[Farming] Initial farm center set to ${this.blackboard.farmCenter}`);
            } else {
                console.log(`[Farming] Ignoring invalid farm center at Y=${centerPos.y}`);
            }
        }

        console.log('[Farming] 🚜 Behavior Tree Farming Role started.');
        this.loop();
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
                
                // Debug output every 10 seconds
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
                
            } catch (error) {
                console.error('[Farming] Loop error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private logStatus() {
        const bb = this.blackboard;
        console.log(`[Farming Status] Hoe:${bb.hasHoe} Seeds:${bb.seedCount} Farmland:${bb.nearbyFarmland.length} Crops:${bb.nearbyMatureCrops.length} Center:${bb.farmCenter || 'none'}`);
    }
}