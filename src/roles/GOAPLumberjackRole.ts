import type { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import {
  createLumberjackBlackboard,
  updateLumberjackBlackboard,
  type LumberjackBlackboard,
} from './lumberjack/LumberjackBlackboard';
import { createLumberjackActions } from '../planning/actions/LumberjackActions';
import { createLumberjackGoals } from '../planning/goals/LumberjackGoals';
import { VillageChat } from '../shared/VillageChat';
import type { GOAPAction } from '../planning/Action';
import type { Goal } from '../planning/Goal';

/**
 * GOAP-based lumberjack role.
 * Uses Goal-Oriented Action Planning to autonomously gather wood.
 */
export class GOAPLumberjackRole extends GOAPRole {
  name = 'goap-lumberjack';

  constructor(config?: GOAPRoleConfig) {
    super(config);
    this.log?.info('Initialized with GOAP planning system');
  }

  protected getActions(): GOAPAction[] {
    const actions = createLumberjackActions();
    this.log?.debug({ actions: actions.map(a => a.name) }, 'Registered actions');
    return actions;
  }

  protected getGoals(): Goal[] {
    const goals = createLumberjackGoals();
    this.log?.debug({ goals: goals.map(g => g.name) }, 'Registered goals');
    return goals;
  }

  protected createBlackboard(): LumberjackBlackboard {
    return createLumberjackBlackboard();
  }

  protected async updateBlackboard(): Promise<void> {
    if (this.bot && this.blackboard) {
      await updateLumberjackBlackboard(this.bot, this.blackboard);
    }
  }

  override start(bot: Bot, options?: any): void {
    // Configure pathfinder
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.digCost = 10;
    bot.pathfinder.setMovements(movements);

    this.log?.info('Starting GOAP lumberjack bot');
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
  }

  override stop(bot: Bot): void {
    this.log?.info('Stopping GOAP lumberjack bot');
    super.stop(bot);
  }

  protected override getWorldview() {
    const bb = this.blackboard as LumberjackBlackboard;
    if (!bb) return null;

    const formatPos = (v: { x: number; y: number; z: number } | null) =>
      v ? `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}` : '-';

    return {
      nearby: [
        { label: 'trees', value: bb.nearbyTrees.length, color: bb.nearbyTrees.length > 0 ? 'green' : undefined },
        { label: 'forest', value: bb.forestTrees.length },
        { label: 'logs', value: bb.nearbyLogs.length },
        { label: 'drops', value: bb.nearbyDrops.length, color: bb.nearbyDrops.length > 0 ? 'yellow' : undefined },
        { label: 'chests', value: bb.nearbyChests.length },
        { label: 'tables', value: bb.nearbyCraftingTables.length },
      ],
      inventory: [
        { label: 'axe', value: bb.hasAxe ? 'yes' : 'no', color: bb.hasAxe ? 'green' : 'red' },
        { label: 'logs', value: bb.logCount },
        { label: 'planks', value: bb.plankCount },
        { label: 'saplings', value: bb.saplingCount },
        { label: 'slots', value: bb.emptySlots, color: bb.emptySlots < 5 ? 'yellow' : undefined },
      ],
      positions: [
        { label: 'village', value: formatPos(bb.villageCenter) },
        { label: 'chest', value: formatPos(bb.sharedChest) },
        { label: 'table', value: formatPos(bb.sharedCraftingTable) },
      ],
      flags: [
        { label: 'canChop', value: bb.canChop, color: bb.canChop ? 'green' : 'gray' },
        { label: 'needsDeposit', value: bb.needsToDeposit, color: bb.needsToDeposit ? 'yellow' : 'gray' },
        { label: 'hasRequests', value: bb.hasPendingRequests, color: bb.hasPendingRequests ? 'cyan' : 'gray' },
        { label: 'invFull', value: bb.inventoryFull, color: bb.inventoryFull ? 'red' : 'gray' },
      ],
    };
  }
}
