import type { Bot } from 'mineflayer';
import { WorldState, type FactValue } from './WorldState';
import type { FarmingBlackboard } from '../roles/farming/Blackboard';

/**
 * Result of executing an action.
 */
export enum ActionResult {
  SUCCESS = 'success',
  FAILURE = 'failure',
  RUNNING = 'running', // Action still in progress
}

/**
 * Precondition check for an action.
 * Returns true if the condition is satisfied in the given world state.
 */
export type Precondition = {
  key: string;
  check: (value: FactValue) => boolean;
  description?: string; // Human-readable description for debugging
};

/**
 * Effect of an action on the world state.
 * Applies a transformation to a fact value.
 */
export type Effect = {
  key: string;
  apply: (ws: WorldState) => FactValue;
  description?: string; // Human-readable description for debugging
};

/**
 * A GOAP action that can be planned and executed.
 *
 * Actions have:
 * - Preconditions: Facts that must be true before the action can execute
 * - Effects: Changes to world state after successful execution
 * - Cost: Planning cost (lower is better, dynamic based on world state)
 * - Execute: Async implementation that performs the action
 */
export interface GOAPAction {
  /**
   * Unique name for this action.
   */
  name: string;

  /**
   * Preconditions that must be satisfied for this action to be executable.
   */
  preconditions: Precondition[];

  /**
   * Effects this action has on the world state when executed successfully.
   */
  effects: Effect[];

  /**
   * Get the cost of this action for planning purposes.
   * Lower cost = higher priority in A* search.
   * Cost can be dynamic based on world state (e.g., distance to target).
   */
  getCost(ws: WorldState): number;

  /**
   * Execute this action on the bot.
   * Returns SUCCESS, FAILURE, or RUNNING.
   *
   * @param bot - The mineflayer bot instance
   * @param bb - The blackboard (for perception and state)
   * @param ws - Current world state (read-only, effects applied by planner)
   * @returns Promise resolving to action result
   */
  execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult>;

  /**
   * Optional: Cancel this action if it's currently running.
   * Used when the executor needs to abort and replan.
   */
  cancel?(): void;
}

/**
 * Helper to create a simple numeric precondition.
 * Example: numericPrecondition('inv.seeds', v => v > 0)
 */
export function numericPrecondition(
  key: string,
  check: (value: number) => boolean,
  description?: string
): Precondition {
  return {
    key,
    check: (value: FactValue) => {
      const num = typeof value === 'number' ? value : 0;
      return check(num);
    },
    description,
  };
}

/**
 * Helper to create a boolean precondition.
 * Example: booleanPrecondition('has.hoe', true)
 */
export function booleanPrecondition(
  key: string,
  expected: boolean,
  description?: string
): Precondition {
  return {
    key,
    check: (value: FactValue) => {
      const bool = typeof value === 'boolean' ? value : false;
      return bool === expected;
    },
    description,
  };
}

/**
 * Helper to create a numeric effect that increments a value.
 * Example: incrementEffect('inv.produce', 10)
 */
export function incrementEffect(
  key: string,
  delta: number,
  description?: string
): Effect {
  return {
    key,
    apply: (ws: WorldState) => {
      const current = ws.getNumber(key);
      return current + delta;
    },
    description,
  };
}

/**
 * Helper to create a numeric effect that sets a value.
 * Example: setEffect('inv.seeds', 0)
 */
export function setEffect(
  key: string,
  value: FactValue,
  description?: string
): Effect {
  return {
    key,
    apply: () => value,
    description,
  };
}

/**
 * Base class for GOAPActions with common functionality.
 */
export abstract class BaseGOAPAction implements GOAPAction {
  abstract name: string;
  abstract preconditions: Precondition[];
  abstract effects: Effect[];

  /**
   * Default cost is 1.0, override for custom costs.
   */
  getCost(ws: WorldState): number {
    return 1.0;
  }

  abstract execute(bot: Bot, bb: FarmingBlackboard, ws: WorldState): Promise<ActionResult>;

  /**
   * Check if all preconditions are satisfied.
   */
  checkPreconditions(ws: WorldState): boolean {
    for (const precond of this.preconditions) {
      const value = ws.get(precond.key);
      if (!precond.check(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Apply all effects to a world state (used by planner for prediction).
   */
  applyEffects(ws: WorldState): void {
    for (const effect of this.effects) {
      const newValue = effect.apply(ws);
      ws.set(effect.key, newValue);
    }
  }

  /**
   * Get a human-readable description of this action's requirements.
   */
  getDescription(): string {
    const precondDescs = this.preconditions
      .filter(p => p.description)
      .map(p => p.description)
      .join(', ');
    const effectDescs = this.effects
      .filter(e => e.description)
      .map(e => e.description)
      .join(', ');

    return `${this.name} [requires: ${precondDescs || 'none'}] [effects: ${effectDescs || 'none'}]`;
  }
}
