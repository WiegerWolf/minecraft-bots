import type { Bot } from 'mineflayer';
import type { GOAPAction, ActionResult } from './Action';
import { ActionResult as ActionResultEnum } from './Action';
import { WorldState } from './WorldState';
import type { FarmingBlackboard } from '../roles/farming/Blackboard';

/**
 * Reason for replanning.
 */
export enum ReplanReason {
  GOAL_COMPLETE = 'goal_complete',
  ACTION_FAILED = 'action_failed',
  WORLD_CHANGED = 'world_changed',
  PLAN_EXHAUSTED = 'plan_exhausted',
}

/**
 * Callback for replan requests.
 */
export type ReplanCallback = (reason: ReplanReason) => void;

/**
 * Configuration for the executor.
 */
export interface PlanExecutorConfig {
  /**
   * Maximum consecutive failures before requesting replan.
   */
  maxFailures: number;

  /**
   * Enable debug logging.
   */
  debug: boolean;
}

/**
 * Execution statistics.
 */
export interface ExecutionStats {
  actionsExecuted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  replansRequested: number;
}

/**
 * PlanExecutor executes a plan (sequence of actions) and monitors for failures.
 * Requests replanning when actions fail or world state changes significantly.
 */
export class PlanExecutor {
  private bot: Bot;
  private blackboard: FarmingBlackboard;
  private config: PlanExecutorConfig;
  private onReplan: ReplanCallback;

  // Execution state
  private currentPlan: GOAPAction[] = [];
  private currentActionIndex: number = 0;
  private currentAction: GOAPAction | null = null;
  private consecutiveFailures: number = 0;
  private initialWorldState: WorldState | null = null;

  // Statistics
  private stats: ExecutionStats = {
    actionsExecuted: 0,
    actionsSucceeded: 0,
    actionsFailed: 0,
    replansRequested: 0,
  };

  constructor(
    bot: Bot,
    blackboard: FarmingBlackboard,
    onReplan: ReplanCallback,
    config?: Partial<PlanExecutorConfig>
  ) {
    this.bot = bot;
    this.blackboard = blackboard;
    this.onReplan = onReplan;
    this.config = {
      maxFailures: config?.maxFailures ?? 3,
      debug: config?.debug ?? false,
    };
  }

  /**
   * Load a new plan for execution.
   */
  loadPlan(plan: GOAPAction[], initialState: WorldState): void {
    this.currentPlan = plan;
    this.currentActionIndex = 0;
    this.currentAction = null;
    this.consecutiveFailures = 0;
    this.initialWorldState = initialState.clone();

    if (this.config.debug) {
      console.log(
        `[PlanExecutor] Loaded plan: ${plan.map(a => a.name).join(' → ')}`
      );
    }
  }

  /**
   * Check if there's a plan currently executing.
   */
  isExecuting(): boolean {
    return this.currentAction !== null || this.currentActionIndex < this.currentPlan.length;
  }

  /**
   * Check if the current plan is complete.
   */
  isComplete(): boolean {
    return this.currentActionIndex >= this.currentPlan.length && this.currentAction === null;
  }

  /**
   * Get the current action being executed.
   */
  getCurrentAction(): GOAPAction | null {
    return this.currentAction;
  }

  /**
   * Execute one step of the plan (call this each tick).
   * Returns true if execution continues, false if plan is complete or replan is needed.
   */
  async tick(currentState: WorldState): Promise<boolean> {
    // No plan loaded
    if (this.currentPlan.length === 0) {
      return false;
    }

    // Plan exhausted
    if (this.currentActionIndex >= this.currentPlan.length) {
      if (this.currentAction === null) {
        if (this.config.debug) {
          console.log('[PlanExecutor] Plan complete');
        }
        this.requestReplan(ReplanReason.PLAN_EXHAUSTED);
        return false;
      }
      // Still executing last action
      return true;
    }

    // Start next action if none is running
    if (this.currentAction === null) {
      const nextAction = this.currentPlan[this.currentActionIndex];
      if (!nextAction) {
        // No action at this index (shouldn't happen but be safe)
        return false;
      }
      this.currentAction = nextAction;

      if (this.config.debug) {
        console.log(
          `[PlanExecutor] Starting action ${this.currentActionIndex + 1}/${this.currentPlan.length}: ${this.currentAction.name}`
        );
      }

      this.stats.actionsExecuted++;
    }

    // Execute current action
    if (!this.currentAction) return false; // Safety check

    try {
      const result = await this.currentAction.execute(
        this.bot,
        this.blackboard,
        currentState
      );

      if (result === ActionResultEnum.SUCCESS) {
        this.handleActionSuccess();
        return true;
      } else if (result === ActionResultEnum.FAILURE) {
        this.handleActionFailure();
        return true;
      } else if (result === ActionResultEnum.RUNNING) {
        // Action still in progress
        return true;
      }
    } catch (error) {
      console.error(`[PlanExecutor] Action ${this.currentAction.name} threw error:`, error);
      this.handleActionFailure();
      return true;
    }

    return true;
  }

  /**
   * Handle successful action completion.
   */
  private handleActionSuccess(): void {
    if (!this.currentAction) return;

    this.stats.actionsSucceeded++;
    this.consecutiveFailures = 0;

    if (this.config.debug) {
      console.log(`[PlanExecutor] Action ${this.currentAction.name} succeeded`);
    }

    // Move to next action
    this.currentAction = null;
    this.currentActionIndex++;
  }

  /**
   * Handle action failure.
   */
  private handleActionFailure(): void {
    if (!this.currentAction) return;

    this.stats.actionsFailed++;
    this.consecutiveFailures++;

    console.log(
      `[PlanExecutor] Action ${this.currentAction.name} failed ` +
      `(consecutive failures: ${this.consecutiveFailures})`
    );

    // Cancel current action if it supports cancellation
    if (this.currentAction.cancel) {
      this.currentAction.cancel();
    }

    // Check if we've exceeded failure threshold
    if (this.consecutiveFailures >= this.config.maxFailures) {
      console.log(
        `[PlanExecutor] Max failures (${this.config.maxFailures}) reached, requesting replan`
      );
      this.requestReplan(ReplanReason.ACTION_FAILED);
      return;
    }

    // Reset and try next action
    this.currentAction = null;
    this.currentActionIndex++;
  }

  /**
   * Check if world state has changed significantly and replan if needed.
   */
  checkWorldStateChange(currentState: WorldState): void {
    if (!this.initialWorldState) return;

    // Calculate significant changes (using helper from WorldStateBuilder)
    const changes = currentState.diff(this.initialWorldState);

    // Threshold for replanning (tune this value)
    const CHANGE_THRESHOLD = 5;

    if (changes >= CHANGE_THRESHOLD) {
      if (this.config.debug) {
        console.log(
          `[PlanExecutor] World state changed significantly (${changes} differences), requesting replan`
        );
      }
      this.requestReplan(ReplanReason.WORLD_CHANGED);
    }
  }

  /**
   * Request a replan.
   */
  private requestReplan(reason: ReplanReason): void {
    this.stats.replansRequested++;

    // Cancel current action if any
    if (this.currentAction && this.currentAction.cancel) {
      this.currentAction.cancel();
    }

    // Clear plan
    this.currentPlan = [];
    this.currentAction = null;
    this.currentActionIndex = 0;
    this.consecutiveFailures = 0;

    // Notify callback
    this.onReplan(reason);
  }

  /**
   * Manually cancel current plan and request replan.
   */
  cancel(reason: ReplanReason = ReplanReason.WORLD_CHANGED): void {
    this.requestReplan(reason);
  }

  /**
   * Get execution statistics.
   */
  getStats(): ExecutionStats {
    return { ...this.stats };
  }

  /**
   * Check if the current/last plan had any failures.
   */
  hadRecentFailures(): boolean {
    return this.consecutiveFailures > 0;
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      actionsExecuted: 0,
      actionsSucceeded: 0,
      actionsFailed: 0,
      replansRequested: 0,
    };
  }

  /**
   * Get plan progress as a percentage.
   */
  getProgress(): number {
    if (this.currentPlan.length === 0) return 0;
    return (this.currentActionIndex / this.currentPlan.length) * 100;
  }

  /**
   * Get human-readable status.
   */
  getStatus(): string {
    if (!this.isExecuting()) {
      return 'idle';
    }
    if (this.currentAction) {
      return `executing: ${this.currentAction.name} (${this.currentActionIndex + 1}/${this.currentPlan.length})`;
    }
    return `planning (${this.currentActionIndex}/${this.currentPlan.length})`;
  }
}
