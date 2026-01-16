import type { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import { createBlackboard, type FarmingBlackboard } from './farming/Blackboard';
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
    console.log('[GOAPFarmingRole] Initialized with GOAP planning system');
  }

  protected getActions(): GOAPAction[] {
    const actions = createFarmingActions();
    console.log(`[GOAPFarmingRole] Actions: ${actions.map(a => a.name).join(', ')}`);
    return actions;
  }

  protected getGoals(): Goal[] {
    const goals = createFarmingGoals();
    console.log(`[GOAPFarmingRole] Goals: ${goals.map(g => g.name).join(', ')}`);
    return goals;
  }

  protected createBlackboard(): FarmingBlackboard {
    return createBlackboard();
  }

  override start(bot: Bot, options?: any): void {
    // Configure pathfinder
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.digCost = 10;
    bot.pathfinder.setMovements(movements);

    console.log('[GOAPFarmingRole] Starting GOAP farming bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChat = new VillageChat(bot);
      this.blackboard.villageChat = villageChat;
    }
  }

  override stop(bot: Bot): void {
    console.log('[GOAPFarmingRole] Stopping GOAP farming bot');
    super.stop(bot);
  }
}
