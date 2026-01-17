import type { Bot } from 'mineflayer';
import { Movements } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { GOAPRole, type GOAPRoleConfig } from './GOAPRole';
import {
  createLumberjackBlackboard,
  updateLumberjackBlackboard,
  type LumberjackBlackboard,
} from './lumberjack/LumberjackBlackboard';
import { createLumberjackActions } from '../planning/actions/LumberjackActions';
import { createLumberjackGoals } from '../planning/goals/LumberjackGoals';
import { VillageChat } from '../shared/VillageChat';
import { readSignsAtSpawn } from '../shared/SignKnowledge';
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
      if (options?.spawnPosition) {
        this.blackboard.spawnPosition = options.spawnPosition;
        this.log?.info({ spawnPosition: options.spawnPosition.toString() }, 'Stored spawn position');

        // Read persistent knowledge from signs at spawn
        this.loadKnowledgeFromSigns(bot, options.spawnPosition, villageChat);
      }
    }
  }

  /**
   * Load persistent knowledge from signs placed near spawn.
   * This allows the bot to recover shared resource locations after disconnects.
   */
  private loadKnowledgeFromSigns(bot: Bot, spawnPos: Vec3, villageChat: VillageChat): void {
    if (!this.blackboard) return;

    const knowledge = readSignsAtSpawn(bot, spawnPos, this.log);

    if (knowledge.size === 0) {
      this.log?.debug('No knowledge signs found at spawn');
      return;
    }

    this.log?.info({ count: knowledge.size }, 'Loading knowledge from signs');

    // Populate blackboard and village chat state
    const villagePos = knowledge.get('VILLAGE');
    if (villagePos) {
      this.blackboard.villageCenter = villagePos;
      villageChat.setVillageCenter(villagePos);
      this.log?.info({ pos: villagePos.toString() }, 'Loaded village center from sign');
    }

    const craftingPos = knowledge.get('CRAFT');
    if (craftingPos) {
      // Verify the block still exists
      const block = bot.blockAt(craftingPos);
      if (block && block.name === 'crafting_table') {
        this.blackboard.sharedCraftingTable = craftingPos;
        villageChat.setSharedCraftingTable(craftingPos);
        this.log?.info({ pos: craftingPos.toString() }, 'Loaded crafting table from sign');
      } else {
        this.log?.warn({ pos: craftingPos.toString() }, 'Crafting table from sign no longer exists');
      }
    }

    const chestPos = knowledge.get('CHEST');
    if (chestPos) {
      // Verify the block still exists
      const block = bot.blockAt(chestPos);
      if (block && block.name === 'chest') {
        this.blackboard.sharedChest = chestPos;
        villageChat.setSharedChest(chestPos);
        this.log?.info({ pos: chestPos.toString() }, 'Loaded chest from sign');
      } else {
        this.log?.warn({ pos: chestPos.toString() }, 'Chest from sign no longer exists');
      }
    }
  }

  override stop(bot: Bot): void {
    this.log?.info('Stopping GOAP lumberjack bot');
    super.stop(bot);
  }
}
