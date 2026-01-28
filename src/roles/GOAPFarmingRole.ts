import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import { createBlackboard, updateBlackboard, type FarmingBlackboard } from './farming/Blackboard';
import { createFarmingActions } from '../planning/actions/FarmingActions';
import { createFarmingGoals } from '../planning/goals/FarmingGoals';
import { VillageChat } from '../shared/VillageChat';
import { createChildLogger } from '../shared/logger';
import type { GOAPAction } from '../planning/Action';
import type { Goal } from '../planning/Goal';
import { ReplanReason } from '../planning/PlanExecutor';

/**
 * Check if the bot is on or near farmland (within 1 block horizontally).
 * Used to prevent jumping which tramples crops.
 */
function isNearFarmland(bot: Bot): boolean {
  const pos = bot.entity.position.floored();

  // Check the block at feet level and 1 below (in case standing on edge)
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (block && block.name === 'farmland') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * GOAP-based farming role.
 * Uses Goal-Oriented Action Planning to autonomously farm crops.
 */
export class GOAPFarmingRole extends GOAPRole {
  name = 'goap-farming';
  private farmlandProtectionInterval: NodeJS.Timeout | null = null;
  private entitySpawnHandler: ((entity: Entity) => void) | null = null;
  private lastDropReplanTime = 0;
  private static readonly DROP_REPLAN_DEBOUNCE_MS = 2000; // Only replan for drops every 2 seconds max

  // Track farm mode for dynamic movement configuration
  private isInFarmMode = false;

  // Cache actions and goals to avoid recreating on every tick
  private cachedActions: GOAPAction[] | null = null;
  private cachedGoals: Goal[] | null = null;

  constructor(config?: GOAPRoleConfig) {
    super(config);
    this.log?.info('Initialized with GOAP planning system');
  }

  protected getActions(): GOAPAction[] {
    if (!this.cachedActions) {
      this.cachedActions = createFarmingActions();
      this.log?.debug({ actions: this.cachedActions.map(a => a.name) }, 'Registered actions');
    }
    return this.cachedActions;
  }

  protected getGoals(): Goal[] {
    if (!this.cachedGoals) {
      this.cachedGoals = createFarmingGoals();
      this.log?.debug({ goals: this.cachedGoals.map(g => g.name) }, 'Registered goals');
    }
    return this.cachedGoals;
  }

  protected createBlackboard(): FarmingBlackboard {
    return createBlackboard();
  }

  protected async updateBlackboard(): Promise<void> {
    if (this.bot && this.blackboard) {
      await updateBlackboard(this.bot, this.blackboard);
    }
  }

  override start(bot: Bot, options?: any): void {
    // Configure pathfinder with full freedom initially
    // Farm protection interval below will toggle allowParkour/allowSprint when near farmland
    const ctx = (bot.pathfinder as any).ctx;
    ctx.canDig = true;
    ctx.allowParkour = true;
    ctx.allowSprint = true;
    this.isInFarmMode = false;

    this.log?.info('Starting GOAP farming bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChatLogger = this.logger ? createChildLogger(this.logger, 'VillageChat') : undefined;
      const villageChat = new VillageChat(bot, villageChatLogger);
      this.blackboard.villageChat = villageChat;

      // Store spawn position from options
      // Note: Signs will be read by the StudySpawnSigns GOAP action (roleplay)
      if (options?.spawnPosition) {
        this.blackboard.spawnPosition = options.spawnPosition;
        this.log?.info({ spawnPosition: options.spawnPosition.toString() }, 'Stored spawn position');
      }
    }

    // Set up farmland protection - dynamically switch movement settings based on location
    this.farmlandProtectionInterval = setInterval(() => {
      const nearFarmland = isNearFarmland(bot);
      const ctx = (bot.pathfinder as any).ctx;

      if (nearFarmland && !this.isInFarmMode) {
        // Entering farm area - disable parkour and sprint to prevent trampling
        ctx.allowParkour = false;
        ctx.allowSprint = false;
        this.isInFarmMode = true;
      } else if (!nearFarmland && this.isInFarmMode) {
        // Leaving farm area - restore normal movements
        ctx.allowParkour = true;
        ctx.allowSprint = true;
        this.isInFarmMode = false;
      }

      if (nearFarmland) {
        // Also clear jump control state as a fallback
        bot.controlState.jump = false;
      }
    }, 50); // Check frequently (20 times per second)

    // Listen for dropped items spawning nearby - trigger immediate replan (debounced)
    // This ensures drops interrupt current work without waiting for next blackboard update
    // Debounce prevents spam when harvesting creates many drops at once
    this.entitySpawnHandler = (entity: Entity) => {
      if (entity.name !== 'item' || !entity.position) return;

      const dist = bot.entity.position.distanceTo(entity.position);
      if (dist < 16) {
        const now = Date.now();
        // Debounce: only trigger replan if enough time has passed since last drop-triggered replan
        if (now - this.lastDropReplanTime < GOAPFarmingRole.DROP_REPLAN_DEBOUNCE_MS) {
          return; // Skip - batch collection will handle this drop
        }
        this.lastDropReplanTime = now;

        // Dropped item appeared nearby - interrupt current plan to collect it
        this.log?.debug({ pos: entity.position.floored().toString(), dist: dist.toFixed(1) }, 'Drop spawned nearby, triggering replan');
        this.executor?.cancel(ReplanReason.WORLD_CHANGED);
      }
    };
    bot.on('entitySpawn', this.entitySpawnHandler);
  }

  override stop(bot: Bot): void {
    this.log?.info('Stopping GOAP farming bot');

    // Clean up farmland protection interval
    if (this.farmlandProtectionInterval) {
      clearInterval(this.farmlandProtectionInterval);
      this.farmlandProtectionInterval = null;
    }

    // Clean up entity spawn listener
    if (this.entitySpawnHandler) {
      bot.removeListener('entitySpawn', this.entitySpawnHandler);
      this.entitySpawnHandler = null;
    }

    // Cleanup VillageChat listeners before stopping
    if (this.blackboard?.villageChat) {
      this.blackboard.villageChat.cleanup();
    }

    super.stop(bot);
  }

  protected override getWorldview() {
    const bb = this.blackboard as FarmingBlackboard;
    if (!bb) return null;

    const formatPos = (v: { x: number; y: number; z: number } | null) =>
      v ? `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}` : '-';

    return {
      nearby: [
        { label: 'water', value: bb.nearbyWater.length },
        { label: 'farmland', value: bb.nearbyFarmland.length },
        { label: 'crops', value: bb.nearbyMatureCrops.length, color: bb.nearbyMatureCrops.length > 0 ? 'green' : undefined },
        { label: 'grass', value: bb.nearbyGrass.length },
        { label: 'drops', value: bb.nearbyDrops.length, color: bb.nearbyDrops.length > 0 ? 'yellow' : undefined },
        { label: 'chests', value: bb.nearbyChests.length },
      ],
      inventory: [
        { label: 'hoe', value: bb.hasHoe ? 'yes' : 'no', color: bb.hasHoe ? 'green' : 'red' },
        { label: 'seeds', value: bb.seedCount },
        { label: 'produce', value: bb.produceCount },
        { label: 'slots', value: bb.emptySlots, color: bb.emptySlots < 5 ? 'yellow' : undefined },
      ],
      positions: [
        { label: 'farm', value: formatPos(bb.farmCenter) },
        { label: 'village', value: formatPos(bb.villageCenter) },
        { label: 'chest', value: formatPos(bb.sharedChest) },
      ],
      flags: [
        { label: 'canPlant', value: bb.canPlant, color: bb.canPlant ? 'green' : 'gray' },
        { label: 'canHarvest', value: bb.canHarvest, color: bb.canHarvest ? 'green' : 'gray' },
        { label: 'needsTools', value: bb.needsTools, color: bb.needsTools ? 'yellow' : 'gray' },
        { label: 'needsSeeds', value: bb.needsSeeds, color: bb.needsSeeds ? 'yellow' : 'gray' },
        { label: 'invFull', value: bb.inventoryFull, color: bb.inventoryFull ? 'red' : 'gray' },
      ],
    };
  }
}
