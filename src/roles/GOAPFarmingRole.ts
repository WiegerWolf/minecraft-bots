import type { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import { createBlackboard, updateBlackboard, type FarmingBlackboard } from './farming/Blackboard';
import { createFarmingActions } from '../planning/actions/FarmingActions';
import { createFarmingGoals } from '../planning/goals/FarmingGoals';
import { VillageChat } from '../shared/VillageChat';
import type { GOAPAction } from '../planning/Action';
import type { Goal } from '../planning/Goal';

/**
 * GOAP-based farming role.
 * Uses Goal-Oriented Action Planning to autonomously farm crops.
 */
export class GOAPFarmingRole extends GOAPRole {
  name = 'goap-farming';

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
    // Configure pathfinder
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.digCost = 10;
    bot.pathfinder.setMovements(movements);

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
  }

  override stop(bot: Bot): void {
    this.log?.info('Stopping GOAP farming bot');
    super.stop(bot);
  }
}
