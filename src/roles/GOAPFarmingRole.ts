import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { Movements } from 'mineflayer-pathfinder';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import { createBlackboard, updateBlackboard, type FarmingBlackboard } from './farming/Blackboard';
import { createFarmingActions } from '../planning/actions/FarmingActions';
import { createFarmingGoals } from '../planning/goals/FarmingGoals';
import { VillageChat } from '../shared/VillageChat';
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

  // Dynamic movement configurations - switch based on location
  private normalMovements: Movements | null = null;
  private farmSafeMovements: Movements | null = null;
  private isInFarmMode = false;

  constructor(config?: GOAPRoleConfig) {
    super(config);
    this.log?.info('Initialized with GOAP planning system');
  }

  protected getActions(): GOAPAction[] {
    const actions = createFarmingActions();
    this.log?.debug({ actions: actions.map(a => a.name) }, 'Registered actions');
    return actions;
  }

  protected getGoals(): Goal[] {
    const goals = createFarmingGoals();
    this.log?.debug({ goals: goals.map(g => g.name) }, 'Registered goals');
    return goals;
  }

  protected createBlackboard(): FarmingBlackboard {
    return createBlackboard();
  }

  protected updateBlackboard(): void {
    if (this.bot && this.blackboard) {
      updateBlackboard(this.bot, this.blackboard);
    }
  }

  override start(bot: Bot, options?: any): void {
    // Create two movement configurations: normal (full freedom) and farm-safe (no jumping)
    this.normalMovements = new Movements(bot);
    this.normalMovements.canDig = true;
    this.normalMovements.digCost = 10;
    this.normalMovements.allowParkour = true;
    this.normalMovements.allowSprinting = true;

    this.farmSafeMovements = new Movements(bot);
    this.farmSafeMovements.canDig = true;
    this.farmSafeMovements.digCost = 10;
    this.farmSafeMovements.allowParkour = false; // Prevent gap-jumping over water/farmland
    this.farmSafeMovements.allowSprinting = false; // Sprinting momentum can cause jumps

    // Start with normal movements
    bot.pathfinder.setMovements(this.normalMovements);
    this.isInFarmMode = false;

    this.log?.info('Starting GOAP farming bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChat = new VillageChat(bot);
      this.blackboard.villageChat = villageChat;

      // Store spawn position from options
      // Note: Signs will be read by the StudySpawnSigns GOAP action (roleplay)
      if (options?.spawnPosition) {
        this.blackboard.spawnPosition = options.spawnPosition;
        this.log?.info({ spawnPosition: options.spawnPosition.toString() }, 'Stored spawn position');
      }
    }

    // Set up farmland protection - dynamically switch movement config based on location
    this.farmlandProtectionInterval = setInterval(() => {
      const nearFarmland = isNearFarmland(bot);

      if (nearFarmland && !this.isInFarmMode) {
        // Entering farm area - switch to safe movements
        bot.pathfinder.setMovements(this.farmSafeMovements!);
        this.isInFarmMode = true;
      } else if (!nearFarmland && this.isInFarmMode) {
        // Leaving farm area - restore normal movements
        bot.pathfinder.setMovements(this.normalMovements!);
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
