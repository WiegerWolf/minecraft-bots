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
    console.log('[GOAPLandscaperRole] Initialized with GOAP planning system (debug mode)');
  }

  protected getActions(): GOAPAction[] {
    const actions = createLandscaperActions();
    console.log(`[GOAPLandscaperRole] Actions: ${actions.map(a => a.name).join(', ')}`);
    return actions;
  }

  protected getGoals(): Goal[] {
    const goals = createLandscaperGoals();
    console.log(`[GOAPLandscaperRole] Goals: ${goals.map(g => g.name).join(', ')}`);
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
    // Configure pathfinder to allow digging
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.digCost = 5; // Lower dig cost since digging is our job
    bot.pathfinder.setMovements(movements);

    console.log('[GOAPLandscaperRole] Starting GOAP landscaper bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChat = new VillageChat(bot);
      this.blackboard.villageChat = villageChat;
    }
  }

  override stop(bot: Bot): void {
    console.log('[GOAPLandscaperRole] Stopping GOAP landscaper bot');
    super.stop(bot);
  }
}
