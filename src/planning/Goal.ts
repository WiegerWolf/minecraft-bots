import { WorldState, type FactValue } from './WorldState';

/**
 * A goal condition that must be satisfied.
 * Similar to action preconditions but represents the desired end state.
 */
export type GoalCondition = {
  key: string;
  check: (value: FactValue) => boolean;
  description?: string;
};

/**
 * A goal represents a desired state that the bot wants to achieve.
 * Goals are selected dynamically based on utility scoring.
 */
export interface Goal {
  /**
   * Unique name for this goal.
   */
  name: string;

  /**
   * Description of what this goal achieves.
   */
  description: string;

  /**
   * Calculate the utility (desirability) of this goal in the current world state.
   * Higher utility = more desirable.
   * Return 0 or negative if the goal is not applicable/achievable.
   *
   * Typical ranges:
   * - 0-20: Low priority, fallback goals (e.g., explore)
   * - 20-50: Moderate priority (e.g., gather resources)
   * - 50-80: High priority (e.g., plant/harvest)
   * - 80-100: Urgent priority (e.g., collect drops before despawn)
   * - 100+: Critical (e.g., multiple urgent items)
   */
  getUtility(ws: WorldState): number;

  /**
   * Conditions that must be true for this goal to be considered satisfied.
   * The planner will search for a sequence of actions that satisfies these conditions.
   */
  conditions: GoalCondition[];

  /**
   * Optional: Check if this goal is still valid/achievable.
   * Return false if the goal should be abandoned (e.g., target disappeared).
   */
  isValid?(ws: WorldState): boolean;

  /**
   * Optional: Priority multiplier for breaking ties.
   * Higher priority goals are preferred when utilities are similar.
   * Default: 1.0
   */
  priority?: number;
}

/**
 * Helper to create a numeric goal condition.
 */
export function numericGoalCondition(
  key: string,
  check: (value: number) => boolean,
  description?: string
): GoalCondition {
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
 * Helper to create a boolean goal condition.
 */
export function booleanGoalCondition(
  key: string,
  expected: boolean,
  description?: string
): GoalCondition {
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
 * Base class for goals with common functionality.
 */
export abstract class BaseGoal implements Goal {
  abstract name: string;
  abstract description: string;
  abstract conditions: GoalCondition[];

  priority: number = 1.0;

  abstract getUtility(ws: WorldState): number;

  /**
   * Check if all goal conditions are satisfied.
   */
  isSatisfied(ws: WorldState): boolean {
    for (const condition of this.conditions) {
      const value = ws.get(condition.key);
      if (!condition.check(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Default implementation: goal is valid if it has positive utility.
   */
  isValid(ws: WorldState): boolean {
    return this.getUtility(ws) > 0;
  }

  /**
   * Get a human-readable description of this goal's conditions.
   */
  getConditionsDescription(): string {
    return this.conditions
      .filter(c => c.description)
      .map(c => c.description)
      .join(', ') || 'none';
  }
}
