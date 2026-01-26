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
import { createChildLogger } from '../shared/logger';
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

    // Allow slabs and cobblestone for scaffolding - preserve DIRT for terraforming
    // Wooden slabs are ideal: easy to break, logs are abundant, less obstructive
    // Cobblestone is also fine - landscapers dig up stone and it shouldn't be wasted
    const mcData = require('minecraft-data')(bot.version);
    const scaffoldingBlockTypes = [
      // Wooden slabs
      'oak_slab', 'spruce_slab', 'birch_slab', 'jungle_slab',
      'acacia_slab', 'dark_oak_slab', 'mangrove_slab', 'cherry_slab',
      'bamboo_slab', 'crimson_slab', 'warped_slab',
      // Stone materials (from digging)
      'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
      'cobbled_deepslate', 'deepslate',
    ];
    const scaffoldingIds = scaffoldingBlockTypes
      .map(name => mcData.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined);
    movements.scafoldingBlocks = scaffoldingIds;

    bot.pathfinder.setMovements(movements);

    this.log?.info('Starting GOAP landscaper bot');
    super.start(bot, options);

    // Initialize village chat if blackboard was created
    if (this.blackboard) {
      const villageChatLogger = this.logger ? createChildLogger(this.logger, 'VillageChat') : undefined;
      const villageChat = new VillageChat(bot, villageChatLogger);
      this.blackboard.villageChat = villageChat;
    }
  }

  override stop(bot: Bot): void {
    this.log?.info('Stopping GOAP landscaper bot');

    // Cleanup VillageChat listeners before stopping
    if (this.blackboard?.villageChat) {
      this.blackboard.villageChat.cleanup();
    }

    super.stop(bot);
  }

  protected override getWorldview() {
    const bb = this.blackboard as LandscaperBlackboard;
    if (!bb) return null;

    const formatPos = (v: { x: number; y: number; z: number } | null) =>
      v ? `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}` : '-';

    // Show terraform progress if active
    const tfPhase = bb.currentTerraformTask?.phase ?? '-';
    const tfProgress = bb.currentTerraformTask?.progress ?? 0;

    return {
      nearby: [
        { label: 'drops', value: bb.nearbyDrops.length, color: bb.nearbyDrops.length > 0 ? 'yellow' : undefined },
        { label: 'chests', value: bb.nearbyChests.length },
        { label: 'tables', value: bb.nearbyCraftingTables.length },
        { label: 'farms', value: bb.knownFarms.length },
        { label: 'issues', value: bb.farmsWithIssues.length, color: bb.farmsWithIssues.length > 0 ? 'yellow' : undefined },
      ],
      inventory: [
        { label: 'shovel', value: bb.hasShovel ? 'yes' : 'no', color: bb.hasShovel ? 'green' : 'red' },
        { label: 'pick', value: bb.hasPickaxe ? 'yes' : 'no', color: bb.hasPickaxe ? 'green' : 'gray' },
        { label: 'dirt', value: bb.dirtCount },
        { label: 'cobble', value: bb.cobblestoneCount },
        { label: 'slots', value: bb.emptySlots, color: bb.emptySlots < 5 ? 'yellow' : undefined },
      ],
      positions: [
        { label: 'village', value: formatPos(bb.villageCenter) },
        { label: 'chest', value: formatPos(bb.sharedChest) },
        { label: 'terraform', value: formatPos(bb.currentTerraformTask?.waterCenter ?? null) },
      ],
      flags: [
        { label: 'canTF', value: bb.canTerraform, color: bb.canTerraform ? 'green' : 'gray' },
        { label: 'hasTFReq', value: bb.hasPendingTerraformRequest, color: bb.hasPendingTerraformRequest ? 'cyan' : 'gray' },
        { label: 'needsTools', value: bb.needsTools, color: bb.needsTools ? 'yellow' : 'gray' },
        { label: 'tfPhase', value: tfPhase },
        { label: 'tfProg', value: `${tfProgress}%` },
      ],
    };
  }
}
