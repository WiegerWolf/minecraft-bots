import type { Goal } from './Goal';
import { WorldState } from './WorldState';
import type { Logger } from '../shared/logger';

/**
 * Configuration for the GoalArbiter.
 */
export interface GoalArbiterConfig {
  /**
   * Hysteresis percentage: new goal must be this much better to switch.
   * Default: 0.2 (20% better)
   */
  hysteresisThreshold: number;

  /**
   * Enable debug logging of goal selection.
   */
  debug: boolean;

  /**
   * Optional logger for structured logging.
   */
  logger?: Logger;
}

/**
 * Result of goal selection.
 */
export interface GoalSelectionResult {
  goal: Goal;
  utility: number;
  reason: string; // Why this goal was selected
}

/**
 * The GoalArbiter selects the most appropriate goal based on utility scoring.
 * Uses hysteresis to prevent rapid switching between similar goals.
 */
export class GoalArbiter {
  private goals: Goal[];
  private currentGoal: Goal | null = null;
  private currentUtility: number = 0;
  private config: Omit<GoalArbiterConfig, 'logger'>;
  private log: Logger | null = null;

  constructor(goals: Goal[], config?: Partial<GoalArbiterConfig>) {
    this.goals = goals;
    this.config = {
      hysteresisThreshold: config?.hysteresisThreshold ?? 0.2,
      debug: config?.debug ?? false,
    };
    this.log = config?.logger ?? null;
  }

  /**
   * Select the best goal for the current world state.
   * Returns null if no valid goals exist.
   * @param ws - Current world state
   * @param skipGoals - Optional set of goal names to skip (e.g., goals on cooldown)
   */
  selectGoal(ws: WorldState, skipGoals?: Set<string>): GoalSelectionResult | null {
    // Score all valid goals
    const scoredGoals: Array<{ goal: Goal; utility: number }> = [];

    for (const goal of this.goals) {
      // Skip goals in the skip list (e.g., on cooldown)
      if (skipGoals && skipGoals.has(goal.name)) {
        continue;
      }

      // Skip invalid goals
      if (goal.isValid && !goal.isValid(ws)) {
        continue;
      }

      const utility = goal.getUtility(ws);

      // Skip goals with zero or negative utility
      if (utility <= 0) {
        continue;
      }

      scoredGoals.push({ goal, utility });
    }

    // No valid goals
    if (scoredGoals.length === 0) {
      if (this.config.debug) {
        this.log?.debug('No valid goals found');
      }
      this.currentGoal = null;
      this.currentUtility = 0;
      return null;
    }

    // Sort by utility (descending), then by priority
    scoredGoals.sort((a, b) => {
      // First compare utilities
      if (a.utility !== b.utility) {
        return b.utility - a.utility;
      }
      // Tie-break with priority
      const aPriority = a.goal.priority ?? 1.0;
      const bPriority = b.goal.priority ?? 1.0;
      return bPriority - aPriority;
    });

    const best = scoredGoals[0];
    if (!best) {
      // Should never happen due to length check above, but makes TypeScript happy
      return null;
    }
    const bestGoal = best.goal;
    const bestUtility = best.utility;

    // Apply hysteresis: only switch if new goal is significantly better
    if (this.currentGoal !== null && this.currentGoal !== bestGoal) {
      // First, re-check if current goal is still valid and has positive utility
      const currentIsValid = this.currentGoal.isValid ? this.currentGoal.isValid(ws) : true;
      const currentUtilityNow = currentIsValid ? this.currentGoal.getUtility(ws) : 0;

      // If current goal's utility has dropped to 0 or below, force switch
      if (currentUtilityNow <= 0) {
        if (this.config.debug) {
          this.log?.debug(
            { currentGoal: this.currentGoal.name, utility: currentUtilityNow.toFixed(1), newGoal: bestGoal.name },
            'Current goal utility dropped, switching'
          );
        }
        // Fall through to select new goal
      } else {
        // Update cached utility to current value
        this.currentUtility = currentUtilityNow;
        const threshold = currentUtilityNow * (1 + this.config.hysteresisThreshold);

        if (bestUtility < threshold) {
          // New goal isn't better enough, stick with current
          if (this.config.debug) {
            this.log?.debug(
              { currentGoal: this.currentGoal.name, currentUtility: currentUtilityNow.toFixed(1), newGoal: bestGoal.name, newUtility: bestUtility.toFixed(1) },
              'Sticking with current goal due to hysteresis'
            );
          }

          return {
            goal: this.currentGoal,
            utility: currentUtilityNow,
            reason: 'hysteresis',
          };
        }
      }
    }

    // Select new goal
    const reason = this.currentGoal === bestGoal ? 'same' : 'switch';
    this.currentGoal = bestGoal;
    this.currentUtility = bestUtility;

    if (this.config.debug) {
      const topGoals = scoredGoals.slice(0, 3).map(
        g => ({ goal: g.goal.name, utility: g.utility.toFixed(1) })
      );
      this.log?.debug(
        { selected: bestGoal.name, utility: bestUtility.toFixed(1), reason, topGoals },
        'Goal selected'
      );
    }

    return {
      goal: bestGoal,
      utility: bestUtility,
      reason,
    };
  }

  /**
   * Get the currently active goal.
   */
  getCurrentGoal(): Goal | null {
    return this.currentGoal;
  }

  /**
   * Get the current goal's utility.
   */
  getCurrentUtility(): number {
    return this.currentUtility;
  }

  /**
   * Force clear the current goal (useful when goal is completed or failed).
   */
  clearCurrentGoal(): void {
    this.currentGoal = null;
    this.currentUtility = 0;
  }

  /**
   * Get all goals managed by this arbiter.
   */
  getGoals(): Goal[] {
    return this.goals;
  }

  /**
   * Get a detailed report of all goal utilities for debugging.
   */
  getGoalReport(ws: WorldState): string {
    const lines: string[] = ['Goal Utilities:'];

    for (const goal of this.goals) {
      const isValid = goal.isValid ? goal.isValid(ws) : true;
      const utility = isValid ? goal.getUtility(ws) : 0;
      const status = !isValid ? '[INVALID]' : utility <= 0 ? '[ZERO]' : '';
      const isCurrent = goal === this.currentGoal ? ' ← CURRENT' : '';

      lines.push(`  ${goal.name}: ${utility.toFixed(1)} ${status}${isCurrent}`);
    }

    return lines.join('\n');
  }
}
