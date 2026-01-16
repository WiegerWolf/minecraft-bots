import type { GOAPAction } from '../Action';
import { WorldState } from '../WorldState';

/**
 * A task in an HTN (Hierarchical Task Network).
 * Tasks can be either primitive (directly executable actions) or compound (decompose into subtasks).
 */
export interface HTNTask {
  /**
   * Unique name for this task.
   */
  name: string;

  /**
   * Check if this task is applicable in the current world state.
   */
  isApplicable(ws: WorldState): boolean;
}

/**
 * A primitive task that maps directly to a GOAP action.
 */
export interface PrimitiveTask extends HTNTask {
  type: 'primitive';

  /**
   * The action to execute for this task.
   */
  action: GOAPAction;
}

/**
 * A compound task that can be decomposed into subtasks using methods.
 */
export interface CompoundTask extends HTNTask {
  type: 'compound';

  /**
   * Methods for decomposing this task.
   * Each method represents a different way to achieve the task.
   * The decomposer will try methods in order until one succeeds.
   */
  methods: HTNMethod[];
}

/**
 * A method for decomposing a compound task into subtasks.
 */
export interface HTNMethod {
  /**
   * Name of this method (for debugging).
   */
  name: string;

  /**
   * Check if this method is applicable in the current world state.
   */
  isApplicable(ws: WorldState): boolean;

  /**
   * Decompose into a sequence of subtasks.
   * Returns the subtasks and the new world state after applying method effects.
   */
  decompose(ws: WorldState): {
    subtasks: HTNTask[];
    newState: WorldState;
  };

  /**
   * Optional: Cost estimate for this decomposition method.
   * Lower cost methods are preferred.
   */
  getCost?(ws: WorldState): number;
}

/**
 * Helper to create a primitive task from a GOAP action.
 */
export function createPrimitiveTask(action: GOAPAction): PrimitiveTask {
  return {
    type: 'primitive',
    name: action.name,
    action,
    isApplicable: (ws: WorldState) => {
      // Check action preconditions
      for (const precond of action.preconditions) {
        const value = ws.get(precond.key);
        if (!precond.check(value)) {
          return false;
        }
      }
      return true;
    },
  };
}

/**
 * Helper to create a compound task.
 */
export function createCompoundTask(
  name: string,
  methods: HTNMethod[],
  isApplicable?: (ws: WorldState) => boolean
): CompoundTask {
  return {
    type: 'compound',
    name,
    methods,
    isApplicable: isApplicable ?? (() => true),
  };
}

/**
 * Base class for HTN methods with common functionality.
 */
export abstract class BaseHTNMethod implements HTNMethod {
  abstract name: string;

  /**
   * Default: method is always applicable (override for specific conditions).
   */
  isApplicable(ws: WorldState): boolean {
    return true;
  }

  abstract decompose(ws: WorldState): {
    subtasks: HTNTask[];
    newState: WorldState;
  };

  /**
   * Default cost: 1.0
   */
  getCost(ws: WorldState): number {
    return 1.0;
  }
}
