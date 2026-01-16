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
    console.log('[GOAPLumberjackRole] Initialized with GOAP planning system');
  }

  protected getActions(): GOAPAction[] {
    const actions = createLumberjackActions();
    console.log(`[GOAPLumberjackRole] Actions: ${actions.map(a => a.name).join(', ')}`);
    return actions;
  }

  protected getGoals(): Goal[] {
    const goals = createLumberjackGoals();
    console.log(`[GOAPLumberjackRole] Goals: ${goals.map(g => g.name).join(', ')}`);
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

    console.log('[GOAPLumberjackRole] Starting GOAP lumberjack bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChat = new VillageChat(bot);
      this.blackboard.villageChat = villageChat;
    }
  }

  override stop(bot: Bot): void {
    console.log('[GOAPLumberjackRole] Stopping GOAP lumberjack bot');
    super.stop(bot);
  }
}
