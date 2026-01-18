import type { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import {
  createLandscaperBlackboard,
  updateLandscaperBlackboard,
  type LandscaperBlackboard,
} from './landscaper/LandscaperBlackboard';
import { createLandscaperActions } from '../planning/actions/LandscaperActions';
import { createLandscaperGoals } from '../planning/goals/LandscaperGoals';
import { VillageChat } from '../shared/VillageChat';
import type { GOAPAction } from '../planning/Action';
import type { Goal } from '../planning/Goal';

/**
 * GOAP-based landscaper role.
 * Uses Goal-Oriented Action Planning to autonomously terraform land for farming.
 */
export class GOAPLandscaperRole extends GOAPRole {
  name = 'goap-landscaper';

  constructor(config?: GOAPRoleConfig) {
    // Enable debug mode for landscaper to troubleshoot planning issues
    super({ debug: true, ...config });
    this.log?.info('Initialized with GOAP planning system (debug mode)');
  }

  protected getActions(): GOAPAction[] {
    const actions = createLandscaperActions();
    this.log?.debug({ actions: actions.map(a => a.name) }, 'Registered actions');
    return actions;
  }

  protected getGoals(): Goal[] {
    const goals = createLandscaperGoals();
    this.log?.debug({ goals: goals.map(g => g.name) }, 'Registered goals');
    return goals;
  }

  protected createBlackboard(): LandscaperBlackboard {
    return createLandscaperBlackboard();
  }

  protected async updateBlackboard(): Promise<void> {
    if (this.bot && this.blackboard) {
      await updateLandscaperBlackboard(this.bot, this.blackboard);
    }
  }

  override start(bot: Bot, options?: any): void {
    // Configure pathfinder to allow digging and limited scaffolding
    // Landscapers need to conserve DIRT for terraforming, but can use cobblestone for navigation
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.digCost = 5; // Lower dig cost since digging is our job
    movements.allowParkour = true;
    movements.allowSprinting = true;

    // Only allow wooden slabs for scaffolding - preserve dirt for terraforming
    // Wooden slabs are ideal: easy to break, logs are abundant, less obstructive
    const mcData = require('minecraft-data')(bot.version);
    const woodenSlabTypes = [
      'oak_slab', 'spruce_slab', 'birch_slab', 'jungle_slab',
      'acacia_slab', 'dark_oak_slab', 'mangrove_slab', 'cherry_slab',
      'bamboo_slab', 'crimson_slab', 'warped_slab'
    ];
    const slabIds = woodenSlabTypes
      .map(name => mcData.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined);
    movements.scafoldingBlocks = slabIds;

    bot.pathfinder.setMovements(movements);

    this.log?.info('Starting GOAP landscaper bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChat = new VillageChat(bot);
      this.blackboard.villageChat = villageChat;
    }
  }

  override stop(bot: Bot): void {
    this.log?.info('Stopping GOAP landscaper bot');
    super.stop(bot);
  }
}
