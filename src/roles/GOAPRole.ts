import type { Bot } from 'mineflayer';
import type { Role, RoleStartOptions } from './Role';
import { WorldState } from '../planning/WorldState';
import { WorldStateBuilder } from '../planning/WorldStateBuilder';
import { GOAPPlanner } from '../planning/GOAPPlanner';
import { GoalArbiter } from '../planning/GoalArbiter';
import { PlanExecutor, ReplanReason } from '../planning/PlanExecutor';
import type { GOAPAction } from '../planning/Action';
import type { Goal } from '../planning/Goal';
import { createChildLogger, type Logger } from '../shared/logger';

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

  /**
   * Optional logger instance for structured logging.
   */
  logger?: Logger;
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
  protected config: Required<Omit<GOAPRoleConfig, 'logger'>>;

  // Logging
  protected logger: Logger | null = null;
  protected log: Logger | null = null; // Child logger for this role

  // Planning components
  protected planner: GOAPPlanner | null = null;
  protected arbiter: GoalArbiter | null = null;
  protected executor: PlanExecutor | null = null;

  // State
  protected running: boolean = false;
  protected tickInterval: NodeJS.Timeout | null = null;
  protected currentWorldState: WorldState | null = null;
  private ticking: boolean = false; // Prevent overlapping ticks

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

    // Store logger if provided (will be used when role starts)
    if (config?.logger) {
      this.logger = config.logger;
    }
  }

  start(bot: Bot, options?: RoleStartOptions): void {
    this.bot = bot;
    this.blackboard = this.createBlackboard();

    // Initialize logger from options or config
    if (options?.logger) {
      this.logger = options.logger;
    }
    if (this.logger) {
      this.log = createChildLogger(this.logger, 'GOAP');
      // Pass logger to blackboard for behavior actions to use
      if (this.blackboard && 'log' in this.blackboard) {
        this.blackboard.log = this.log;
      }
    }

    // Initialize planning components now that we have bot and blackboard
    const actions = this.getActions();
    const goals = this.getGoals();

    // Create child loggers for planning components
    const plannerLogger = this.logger ? createChildLogger(this.logger, 'Planner') : undefined;
    const executorLogger = this.logger ? createChildLogger(this.logger, 'Executor') : undefined;

    this.planner = new GOAPPlanner(actions, {
      maxIterations: this.config.maxPlanIterations,
      debug: this.config.debug,
      logger: plannerLogger,
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
        logger: executorLogger,
      }
    );

    this.running = true;
    this.log?.info({ role: this.name }, 'Role started');

    // Start the main loop
    // Note: We use a guard to prevent overlapping ticks since pathfinding
    // operations can take longer than the tick interval
    this.tickInterval = setInterval(() => {
      if (this.ticking) return; // Skip if previous tick still running
      this.ticking = true;
      this.tick()
        .catch(err => {
          this.log?.error({ err }, 'Tick error');
        })
        .finally(() => {
          this.ticking = false;
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

    this.log?.info({ role: this.name }, 'Role stopped');
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
   * Check if the bot is actually connected to the server.
   */
  private isBotConnected(): boolean {
    if (!this.bot) return false;
    try {
      const client = (this.bot as any)._client;
      if (!client || !client.socket || client.socket.destroyed) {
        return false;
      }
      // Also check if entity exists (means we're spawned)
      if (!this.bot.entity) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Main planning loop tick.
   */
  protected async tick(): Promise<void> {
    if (!this.running || !this.bot || !this.blackboard) return;

    // Check for zombie state - bot object exists but connection is dead
    if (!this.isBotConnected()) {
      this.log?.error({ role: this.name }, 'Connection lost, stopping role');
      this.stop(this.bot);
      return;
    }

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
      this.log?.error({ err: error }, 'Error in tick');
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
      this.log?.debug({ goalsOnCooldown: Array.from(goalsOnCooldown) }, 'Goals on cooldown');
    }

    // Select the best goal, skipping any on cooldown
    const goalResult = this.arbiter.selectGoal(this.currentWorldState, goalsOnCooldown);

    if (!goalResult) {
      if (this.config.debug) {
        this.log?.debug('No valid goals, idling');
      }
      return;
    }

    const { goal, utility, reason } = goalResult;

    // Log goal selection
    if (this.config.debug || reason === 'switch') {
      this.log?.info({ goal: goal.name, utility: utility.toFixed(1), reason }, 'Goal selected');
    }

    // Plan actions to achieve goal
    const planResult = this.planner.plan(this.currentWorldState, goal);

    if (!planResult.success) {
      this.log?.warn({ goal: goal.name }, 'Failed to plan for goal');
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
      this.log?.debug(
        { plan: planResult.plan.map(a => a.name), cost: planResult.cost.toFixed(1) },
        'Plan created'
      );
    }

    this.executor.loadPlan(planResult.plan, this.currentWorldState);
  }

  /**
   * Handle replan requests from the executor.
   */
  private handleReplanRequest(reason: ReplanReason): void {
    // Check if there were failures during plan execution
    const hadFailures = this.executor?.hadRecentFailures() ?? false;

    this.log?.info({ reason, hadFailures }, 'Replan requested');

    // Clear current goal and apply cooldown if needed
    if (this.arbiter) {
      const currentGoal = this.arbiter.getCurrentGoal();

      // Put goal on cooldown if action failed OR plan exhausted with failures
      // This prevents the same failing goal from being selected immediately
      if (currentGoal && (reason === ReplanReason.ACTION_FAILED ||
          (reason === ReplanReason.PLAN_EXHAUSTED && hadFailures))) {
        this.failedGoalCooldowns.set(currentGoal.name, Date.now() + 5000);
        this.log?.debug({ goal: currentGoal.name, reason }, 'Goal placed on 5s cooldown');
      }

      // Clear current goal so arbiter picks a new one
      if (reason === ReplanReason.ACTION_FAILED ||
          reason === ReplanReason.WORLD_CHANGED ||
          reason === ReplanReason.PLAN_EXHAUSTED) {
        this.arbiter.clearCurrentGoal();
      }
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
