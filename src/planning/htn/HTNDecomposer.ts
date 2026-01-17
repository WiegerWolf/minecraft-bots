import type { GOAPAction } from '../Action';
import { WorldState } from '../WorldState';
import type { HTNTask, CompoundTask, PrimitiveTask } from './HTNTask';
import type { Logger } from '../../shared/logger';

/**
 * Result of HTN decomposition.
 */
export interface HTNDecompositionResult {
  success: boolean;
  actions: GOAPAction[]; // Sequence of primitive actions
  cost: number; // Total estimated cost
  depth: number; // Decomposition depth for debugging
}

/**
 * Configuration for the decomposer.
 */
export interface HTNDecomposerConfig {
  maxDepth: number; // Maximum recursion depth
  debug: boolean;
  logger?: Logger;
}

/**
 * HTN Decomposer - recursively decomposes compound tasks into primitive actions.
 */
export class HTNDecomposer {
  private config: Omit<HTNDecomposerConfig, 'logger'>;
  private log: Logger | null = null;

  constructor(config?: Partial<HTNDecomposerConfig>) {
    this.config = {
      maxDepth: config?.maxDepth ?? 10,
      debug: config?.debug ?? false,
    };
    this.log = config?.logger ?? null;
  }

  /**
   * Decompose a task into a sequence of primitive actions.
   */
  decompose(task: HTNTask, initialState: WorldState): HTNDecompositionResult {
    const startTime = Date.now();

    if (!task.isApplicable(initialState)) {
      if (this.config.debug) {
        this.log?.debug({ task: task.name }, 'Task not applicable');
      }
      return {
        success: false,
        actions: [],
        cost: 0,
        depth: 0,
      };
    }

    const result = this.decomposeRecursive(task, initialState, 0);
    const elapsed = Date.now() - startTime;

    if (this.config.debug) {
      if (result.success) {
        this.log?.debug(
          { task: task.name, plan: result.actions.map(a => a.name), depth: result.depth, cost: result.cost.toFixed(1), timeMs: elapsed },
          'Task decomposed'
        );
      } else {
        this.log?.debug(
          { task: task.name, timeMs: elapsed },
          'Failed to decompose task'
        );
      }
    }

    return result;
  }

  /**
   * Recursive decomposition helper.
   */
  private decomposeRecursive(
    task: HTNTask,
    state: WorldState,
    depth: number
  ): HTNDecompositionResult {
    // Check depth limit
    if (depth >= this.config.maxDepth) {
      if (this.config.debug) {
        this.log?.debug({ task: task.name, depth }, 'Max depth reached');
      }
      return { success: false, actions: [], cost: 0, depth };
    }

    // Primitive task: return the action directly
    if ('action' in task) {
      const primitiveTask = task as PrimitiveTask;
      return {
        success: true,
        actions: [primitiveTask.action],
        cost: primitiveTask.action.getCost(state),
        depth,
      };
    }

    // Compound task: try methods in order
    const compoundTask = task as CompoundTask;

    // Sort methods by cost (if available)
    const sortedMethods = [...compoundTask.methods].sort((a, b) => {
      const costA = a.getCost ? a.getCost(state) : 1.0;
      const costB = b.getCost ? b.getCost(state) : 1.0;
      return costA - costB;
    });

    for (const method of sortedMethods) {
      // Check if method is applicable
      if (!method.isApplicable(state)) {
        continue;
      }

      // Decompose using this method
      const { subtasks, newState } = method.decompose(state);

      // Recursively decompose all subtasks
      const allActions: GOAPAction[] = [];
      let totalCost = 0;
      let maxDepth = depth;
      let success = true;

      for (const subtask of subtasks) {
        const result = this.decomposeRecursive(subtask, newState, depth + 1);

        if (!result.success) {
          success = false;
          break;
        }

        allActions.push(...result.actions);
        totalCost += result.cost;
        maxDepth = Math.max(maxDepth, result.depth);
      }

      // If all subtasks succeeded, return this decomposition
      if (success) {
        return {
          success: true,
          actions: allActions,
          cost: totalCost,
          depth: maxDepth,
        };
      }
    }

    // No method succeeded
    return { success: false, actions: [], cost: 0, depth };
  }

  /**
   * Decompose multiple tasks in sequence.
   */
  decomposeSequence(
    tasks: HTNTask[],
    initialState: WorldState
  ): HTNDecompositionResult {
    const allActions: GOAPAction[] = [];
    let totalCost = 0;
    let maxDepth = 0;
    let currentState = initialState.clone();

    for (const task of tasks) {
      const result = this.decompose(task, currentState);

      if (!result.success) {
        return { success: false, actions: [], cost: 0, depth: maxDepth };
      }

      allActions.push(...result.actions);
      totalCost += result.cost;
      maxDepth = Math.max(maxDepth, result.depth);

      // Update state with effects of decomposed actions
      for (const action of result.actions) {
        for (const effect of action.effects) {
          const newValue = effect.apply(currentState);
          currentState.set(effect.key, newValue);
        }
      }
    }

    return {
      success: true,
      actions: allActions,
      cost: totalCost,
      depth: maxDepth,
    };
  }
}
