import type { Bot } from 'mineflayer';
import type { Role } from './Role';
import { WorldState } from '../planning/WorldState';
import { WorldStateBuilder } from '../planning/WorldStateBuilder';
import { GOAPPlanner } from '../planning/GOAPPlanner';
import { GoalArbiter } from '../planning/GoalArbiter';
import { PlanExecutor, ReplanReason } from '../planning/PlanExecutor';
import type { GOAPAction } from '../planning/Action';
import type { Goal } from '../planning/Goal';

/**
 * Configuration for GOAP-based roles.
 */
export interface GOAPRoleConfig {
  /**
   * Enable debug logging for planning decisions.
   */
  debug?: boolean;

  /**
   * Tick interval in milliseconds.
   */
  tickInterval?: number;

  /**
   * Maximum planning iterations before giving up.
   */
  maxPlanIterations?: number;
}

/**
 * Base class for roles that use GOAP planning.
 *
 * Implements the main planning loop:
 * 1. PERCEIVE: Update blackboard with world state
 * 2. DECIDE: Select goal and plan actions
 * 3. ACT: Execute plan
 * 4. MONITOR: Check for replan triggers
 */
export abstract class GOAPRole implements Role {
  abstract name: string;

  protected bot: Bot | null = null;
  protected blackboard: any = null;
  protected config: Required<GOAPRoleConfig>;

  // Planning components
  protected planner: GOAPPlanner | null = null;
  protected arbiter: GoalArbiter | null = null;
  protected executor: PlanExecutor | null = null;

  // State
  protected running: boolean = false;
  protected tickInterval: NodeJS.Timeout | null = null;
  protected currentWorldState: WorldState | null = null;

  // Failed goal cooldowns: goal name -> timestamp when cooldown expires
  private failedGoalCooldowns: Map<string, number> = new Map();

  // Actions and goals to use (set by subclass)
  protected abstract getActions(): GOAPAction[];
  protected abstract getGoals(): Goal[];

  constructor(config?: GOAPRoleConfig) {
    this.config = {
      debug: config?.debug ?? false,
      tickInterval: config?.tickInterval ?? 100,
      maxPlanIterations: config?.maxPlanIterations ?? 1000,
    };
  }

  start(bot: Bot, options?: any): void {
    this.bot = bot;
    this.blackboard = this.createBlackboard();

    // Initialize planning components now that we have bot and blackboard
    const actions = this.getActions();
    const goals = this.getGoals();

    this.planner = new GOAPPlanner(actions, {
      maxIterations: this.config.maxPlanIterations,
      debug: this.config.debug,
    });

    this.arbiter = new GoalArbiter(goals, {
      hysteresisThreshold: 0.2,
      debug: this.config.debug,
    });

    this.executor = new PlanExecutor(
      bot,
      this.blackboard,
      (reason) => this.handleReplanRequest(reason),
      {
        maxFailures: 3,
        debug: this.config.debug,
      }
    );

    this.running = true;
    console.log('[GOAP] Role started');

    // Start the main loop
    this.tickInterval = setInterval(() => {
      this.tick().catch(err => {
        console.error('[GOAP] Tick error:', err);
      });
    }, this.config.tickInterval);
  }

  stop(bot: Bot): void {
    this.running = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Cancel any running executor
    if (this.executor) {
      this.executor.cancel();
    }

    console.log('[GOAP] Role stopped');
  }

  /**
   * Create the blackboard for this role (override if needed).
   */
  protected abstract createBlackboard(): any;

  /**
   * Update the blackboard with current world state.
   * Must be implemented by subclasses.
   */
  protected abstract updateBlackboard(): void | Promise<void>;

  /**
   * Main planning loop tick.
   */
  protected async tick(): Promise<void> {
    if (!this.running || !this.bot || !this.blackboard) return;

    try {
      // PHASE 1: PERCEIVE
      await this.updateBlackboard();
      this.currentWorldState = WorldStateBuilder.fromBlackboard(this.bot, this.blackboard);

      // PHASE 2: DECIDE (if no plan is executing)
      if (this.executor && !this.executor.isExecuting()) {
        await this.planNextGoal();
      }

      // PHASE 3: ACT
      let actionExecuted = false;
      if (this.executor && this.executor.isExecuting() && this.currentWorldState) {
        await this.executor.tick(this.currentWorldState);
        actionExecuted = true;
      }

      // PHASE 4: MONITOR
      if (this.executor && this.executor.isExecuting() && this.currentWorldState) {
        this.executor.checkWorldStateChange(this.currentWorldState);
      }

      // PHASE 5: IDLE TRACKING
      // Increment idle ticks when no action is executing (helps PatrolForest trigger)
      if (this.blackboard && 'consecutiveIdleTicks' in this.blackboard) {
        if (actionExecuted) {
          this.blackboard.consecutiveIdleTicks = 0;
        } else {
          this.blackboard.consecutiveIdleTicks++;
        }
      }
    } catch (error) {
      console.error('[GOAP] Error in tick:', error);
    }
  }

  /**
   * Plan for the next goal.
   */
  private async planNextGoal(): Promise<void> {
    if (!this.currentWorldState || !this.arbiter || !this.planner || !this.executor) return;

    // Clean up expired cooldowns and build skip set
    const now = Date.now();
    const goalsOnCooldown = new Set<string>();
    for (const [goalName, expiry] of this.failedGoalCooldowns) {
      if (now >= expiry) {
        this.failedGoalCooldowns.delete(goalName);
      } else {
        goalsOnCooldown.add(goalName);
      }
    }

    // Log cooldowns if any
    if (goalsOnCooldown.size > 0 && this.config.debug) {
      console.log(`[GOAP] Goals on cooldown: ${Array.from(goalsOnCooldown).join(', ')}`);
    }

    // Select the best goal, skipping any on cooldown
    const goalResult = this.arbiter.selectGoal(this.currentWorldState, goalsOnCooldown);

    if (!goalResult) {
      if (this.config.debug) {
        console.log('[GOAP] No valid goals, idling');
      }
      return;
    }

    const { goal, utility, reason } = goalResult;

    // Log goal selection
    if (this.config.debug || reason === 'switch') {
      console.log(
        `[GOAP] Goal: ${goal.name} (utility: ${utility.toFixed(1)}, reason: ${reason})`
      );
    }

    // Plan actions to achieve goal
    const planResult = this.planner.plan(this.currentWorldState, goal);

    if (!planResult.success) {
      console.log(`[GOAP] Failed to plan for goal: ${goal.name}`);
      // Put goal on cooldown (5 seconds) before trying again
      this.failedGoalCooldowns.set(goal.name, now + 5000);
      // Clear current goal so we can try another
      this.arbiter.clearCurrentGoal();
      return;
    }

    // Planning succeeded, clear any cooldown for this goal
    this.failedGoalCooldowns.delete(goal.name);

    // Load plan into executor
    if (this.config.debug) {
      console.log(
        `[GOAP] Plan: ${planResult.plan.map(a => a.name).join(' → ')} ` +
        `(cost: ${planResult.cost.toFixed(1)})`
      );
    }

    this.executor.loadPlan(planResult.plan, this.currentWorldState);
  }

  /**
   * Handle replan requests from the executor.
   */
  private handleReplanRequest(reason: ReplanReason): void {
    if (this.config.debug) {
      console.log(`[GOAP] Replan requested: ${reason}`);
    }

    // Clear current goal if plan failed or world changed significantly
    if (this.arbiter && (reason === ReplanReason.ACTION_FAILED || reason === ReplanReason.WORLD_CHANGED)) {
      this.arbiter.clearCurrentGoal();
    }

    // Next tick will trigger replanning
  }

  /**
   * Get current status for debugging.
   */
  getStatus(): string {
    if (!this.arbiter || !this.executor) return 'Not initialized';

    const goal = this.arbiter.getCurrentGoal();
    const executorStatus = this.executor.getStatus();
    const progress = this.executor.getProgress();

    if (goal) {
      return `Goal: ${goal.name} | ${executorStatus} | ${progress.toFixed(0)}%`;
    }

    return 'Idle';
  }

  /**
   * Get execution statistics.
   */
  getStats() {
    if (!this.executor) return null;
    return this.executor.getStats();
  }

  /**
   * Get goal report for debugging.
   */
  getGoalReport(): string {
    if (!this.currentWorldState || !this.arbiter) return 'Not initialized';
    return this.arbiter.getGoalReport(this.currentWorldState);
  }
}
