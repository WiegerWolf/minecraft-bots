import { WorldState } from '../../WorldState';
import type { HTNTask } from '../HTNTask';
import { createCompoundTask, BaseHTNMethod } from '../HTNTask';

/**
 * Example HTN Task: Obtain a hoe
 *
 * This demonstrates hierarchical decomposition with multiple methods:
 * 1. Craft from existing materials (fastest)
 * 2. Gather wood then craft (requires tree chopping)
 * 3. Find and take from chest (if available)
 *
 * The decomposer will try methods in order of cost and applicability.
 */

/**
 * Method 1: Craft hoe from existing materials (planks + sticks in inventory)
 */
class CraftHoeFromMaterialsMethod extends BaseHTNMethod {
  name = 'CraftHoeFromMaterials';

  override isApplicable(ws: WorldState): boolean {
    return ws.getBool('derived.canCraftHoe');
  }

  override decompose(ws: WorldState): { subtasks: HTNTask[]; newState: WorldState } {
    const newState = ws.clone();

    // Subtasks (these would reference actual primitive tasks in Phase 4):
    // 1. Ensure we have a crafting table nearby or place one
    // 2. Craft sticks if needed (2 planks -> 4 sticks)
    // 3. Craft wooden hoe (2 planks + 2 sticks -> hoe)

    const subtasks: HTNTask[] = [
      // TODO Phase 4: Create these primitive tasks
      // createPrimitiveTask(new EnsureCraftingTableAction()),
      // createPrimitiveTask(new CraftSticksAction()),
      // createPrimitiveTask(new CraftWoodenHoeAction()),
    ];

    // Update state with effects
    newState.set('has.hoe', true);
    newState.set('inv.planks', Math.max(0, ws.getNumber('inv.planks') - 2));
    newState.set('inv.sticks', Math.max(0, ws.getNumber('inv.sticks') - 2));

    return { subtasks, newState };
  }

  override getCost(ws: WorldState): number {
    // Low cost - we already have materials
    return 1.0;
  }
}

/**
 * Method 2: Gather wood, process it, then craft hoe
 */
class GatherWoodAndCraftMethod extends BaseHTNMethod {
  name = 'GatherWoodAndCraft';

  override isApplicable(ws: WorldState): boolean {
    // Always applicable - we can always try to find trees
    return true;
  }

  override decompose(ws: WorldState): { subtasks: HTNTask[]; newState: WorldState } {
    const newState = ws.clone();

    // Subtasks:
    // 1. Chop trees to get logs
    // 2. Craft planks from logs
    // 3. Craft sticks from planks
    // 4. Craft hoe from planks + sticks

    const subtasks: HTNTask[] = [
      // TODO Phase 4: Create these primitive tasks
      // createPrimitiveTask(new ChopTreesAction(4)), // Get 4 logs
      // createPrimitiveTask(new CraftPlanksAction()),
      // createPrimitiveTask(new EnsureCraftingTableAction()),
      // createPrimitiveTask(new CraftSticksAction()),
      // createPrimitiveTask(new CraftWoodenHoeAction()),
    ];

    // Update state with effects (simplified)
    newState.set('has.hoe', true);
    newState.set('inv.logs', ws.getNumber('inv.logs') + 4);
    newState.set('inv.planks', ws.getNumber('inv.planks') + 16); // 4 logs -> 16 planks
    newState.set('inv.sticks', ws.getNumber('inv.sticks') + 4);

    return { subtasks, newState };
  }

  override getCost(ws: WorldState): number {
    // Higher cost - requires gathering resources
    return 5.0;
  }
}

/**
 * Method 3: Find hoe in chest (if available)
 */
class FindHoeInChestMethod extends BaseHTNMethod {
  name = 'FindHoeInChest';

  override isApplicable(ws: WorldState): boolean {
    // Only applicable if we have access to storage
    return ws.getBool('derived.hasStorageAccess');
  }

  override decompose(ws: WorldState): { subtasks: HTNTask[]; newState: WorldState } {
    const newState = ws.clone();

    // Subtasks:
    // 1. Navigate to chest
    // 2. Open chest and search for hoe
    // 3. Take hoe if found

    const subtasks: HTNTask[] = [
      // TODO Phase 4: Create these primitive tasks
      // createPrimitiveTask(new SearchChestForItemAction('hoe')),
    ];

    // Update state with effects
    newState.set('has.hoe', true);

    return { subtasks, newState };
  }

  override getCost(ws: WorldState): number {
    // Medium cost - fast if chest is nearby with hoe
    return 2.0;
  }
}

/**
 * Create the ObtainHoe compound task with all methods.
 */
export function createObtainHoeTask(): HTNTask {
  return createCompoundTask(
    'ObtainHoe',
    [
      new CraftHoeFromMaterialsMethod(), // Try this first (cheapest)
      new FindHoeInChestMethod(),        // Then try chest
      new GatherWoodAndCraftMethod(),    // Last resort (expensive)
    ],
    (ws: WorldState) => {
      // Task is applicable if we don't have a hoe
      return !ws.getBool('has.hoe');
    }
  );
}

/**
 * Example usage:
 *
 * const decomposer = new HTNDecomposer({ debug: true });
 * const obtainHoeTask = createObtainHoeTask();
 * const result = decomposer.decompose(obtainHoeTask, currentState);
 *
 * if (result.success) {
 *   // Execute result.actions in sequence
 *   for (const action of result.actions) {
 *     await action.execute(bot, blackboard, worldState);
 *   }
 * }
 */
