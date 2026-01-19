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
import {
  isInHole,
  escapeFromHole,
  recordPathfindingFailure,
  resetStuckTracker,
  type StuckTracker,
} from '../shared/PathfindingUtils';

/**
 * Action history entry for state reporting.
 */
interface ActionHistoryEntry {
  action: string;
  timestamp: number;
  success: boolean;
  failureCount?: number;
}

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

  // Track consecutive planning failures for hole escape detection
  private consecutivePlanningFailures: number = 0;
  private lastPlanningFailureTime: number = 0;

  // State reporting for TUI
  private actionHistory: ActionHistoryEntry[] = [];
  private stateEmitCounter: number = 0;
  private lastAction: string | null = null;
  private botName: string = '';
  private static readonly STATE_EMIT_INTERVAL = 1; // Emit every tick (100ms) for realtime updates
  private static readonly MAX_ACTION_HISTORY = 10;

  // Preemption threshold: a new goal must have this much MORE utility (absolute)
  // to interrupt a running action. This is higher than normal hysteresis because
  // interrupting an action mid-execution has a cost.
  // Example: RespondToTradeOffer (120) can preempt ObtainTools (80) since 120 > 80 + 30
  private static readonly PREEMPTION_UTILITY_THRESHOLD = 30;

  // Actions and goals to use (set by subclass)
  protected abstract getActions(): GOAPAction[];
  protected abstract getGoals(): Goal[];

  /**
   * Extract worldview data from blackboard for TUI display.
   * Override in subclasses to provide role-specific worldview.
   */
  protected getWorldview(): {
    nearby: { label: string; value: string | number | boolean; color?: string }[];
    inventory: { label: string; value: string | number | boolean; color?: string }[];
    positions: { label: string; value: string | number | boolean; color?: string }[];
    flags: { label: string; value: string | number | boolean; color?: string }[];
  } | null {
    return null;
  }

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

    // Store bot name for state reporting
    this.botName = bot.username || process.env.BOT_NAME || 'Unknown';

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

      // PHASE 2: DECIDE
      if (this.executor && !this.executor.isExecuting()) {
        // No plan executing - select a goal and plan
        await this.planNextGoal();
      } else if (this.executor && this.executor.isExecuting()) {
        // Plan is executing - check if a much higher priority goal should preempt
        // This allows urgent goals (like RespondToTradeOffer) to interrupt
        // long-running actions (like CheckSharedChest returning RUNNING)
        await this.checkGoalPreemption();
      }

      // PHASE 3: ACT
      let actionExecuted = false;
      const actionBefore = this.executor?.getCurrentAction()?.name ?? null;
      if (this.executor && this.executor.isExecuting() && this.currentWorldState) {
        await this.executor.tick(this.currentWorldState);
        actionExecuted = true;
      }
      const actionAfter = this.executor?.getCurrentAction()?.name ?? null;

      // Track action completion for history
      if (actionBefore && actionBefore !== actionAfter) {
        // Action changed - previous action completed
        const hadFailures = this.executor?.hadRecentFailures() ?? false;
        this.recordActionCompletion(actionBefore, !hadFailures);
      }

      // PHASE 4: MONITOR
      if (this.executor && this.executor.isExecuting() && this.currentWorldState) {
        this.executor.checkWorldStateChange(this.currentWorldState);
      }

      // PHASE 5: IDLE TRACKING
      // Only reset idle ticks on SUCCESSFUL action execution, not on failures.
      // This ensures ExploreGoal triggers after repeated action failures,
      // allowing the bot to move and find resources (grass, water) when stuck.
      if (this.blackboard && 'consecutiveIdleTicks' in this.blackboard) {
        const actionSucceeded = actionExecuted && this.executor && !this.executor.hadRecentFailures();
        if (actionSucceeded) {
          this.blackboard.consecutiveIdleTicks = 0;
        } else {
          this.blackboard.consecutiveIdleTicks++;
        }
      }

      // PHASE 6: STATE EMISSION
      this.stateEmitCounter++;
      if (this.stateEmitCounter >= GOAPRole.STATE_EMIT_INTERVAL) {
        this.stateEmitCounter = 0;
        this.emitState();
      }
    } catch (error) {
      this.log?.error({ err: error }, 'Error in tick');
    }
  }

  /**
   * Record an action completion for history tracking.
   */
  private recordActionCompletion(actionName: string, success: boolean): void {
    // Check if the last entry is the same action (update failure count)
    const lastEntry = this.actionHistory[0];
    if (lastEntry && lastEntry.action === actionName && !success && !lastEntry.success) {
      lastEntry.failureCount = (lastEntry.failureCount || 1) + 1;
      lastEntry.timestamp = Date.now();
      return;
    }

    // Add new entry
    this.actionHistory.unshift({
      action: actionName,
      timestamp: Date.now(),
      success,
      failureCount: success ? undefined : 1,
    });

    // Trim to max size
    if (this.actionHistory.length > GOAPRole.MAX_ACTION_HISTORY) {
      this.actionHistory.pop();
    }
  }

  /**
   * Emit current bot state to stdout for the TUI manager.
   */
  private emitState(): void {
    if (!this.arbiter || !this.executor || !this.currentWorldState) return;

    const currentGoal = this.arbiter.getCurrentGoal();
    const currentAction = this.executor.getCurrentAction();
    const stats = this.executor.getStats();

    // Build goal utilities list
    const currentGoalName = currentGoal?.name ?? null;
    const goalUtilities = this.getGoals().map(goal => {
      const isValid = goal.isValid ? goal.isValid(this.currentWorldState!) : true;
      const utility = isValid ? goal.getUtility(this.currentWorldState!) : 0;
      return {
        name: goal.name,
        utility,
        isCurrent: goal.name === currentGoalName,
        isInvalid: !isValid,
        isZero: utility <= 0,
      };
    });

    // Sort by utility descending
    goalUtilities.sort((a, b) => b.utility - a.utility);

    // Get action progress info from executor status
    let actionProgress: { current: number; total: number } | null = null;
    const status = this.executor.getStatus();
    const progressMatch = status.match(/\((\d+)\/(\d+)\)/);
    if (progressMatch) {
      actionProgress = {
        current: parseInt(progressMatch[1]!, 10),
        total: parseInt(progressMatch[2]!, 10),
      };
    }

    // Build inventory list with held item marked
    const heldItemSlot = this.bot?.quickBarSlot ?? -1;
    const inventory = this.bot?.inventory.items().map(item => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
      isHeld: item.slot === heldItemSlot + 36, // Hotbar slots are 36-44
    })) ?? [];

    // Get bot position
    const pos = this.bot?.entity?.position;
    const position = pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : undefined;

    const stateMessage = {
      type: 'bot_state',
      botName: this.botName,
      timestamp: Date.now(),
      currentGoal: currentGoal?.name ?? null,
      currentGoalUtility: this.arbiter.getCurrentUtility(),
      currentAction: currentAction?.name ?? null,
      actionProgress,
      planProgress: this.executor.getProgress(),
      goalUtilities,
      actionHistory: this.actionHistory,
      stats,
      goalsOnCooldown: Array.from(this.failedGoalCooldowns.keys()),
      inventory,
      worldview: this.getWorldview(),
      position,
    };

    // Write to stdout as JSON (will be parsed by manager)
    console.log(JSON.stringify(stateMessage));
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

      // Track planning failures for hole escape detection
      // If planning keeps failing and we're in a hole, we need to escape
      await this.checkHoleEscapeOnPlanningFailure();

      return;
    }

    // Planning succeeded, clear any cooldown for this goal
    this.failedGoalCooldowns.delete(goal.name);

    // Reset planning failure counter on success
    this.consecutivePlanningFailures = 0;

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
   * Check if a higher-priority goal should preempt the current running action.
   * This is called while an action is executing (returning RUNNING) to allow
   * urgent goals to interrupt long-running actions.
   *
   * Uses a higher threshold than normal goal switching to avoid thrashing -
   * the new goal must be significantly better to justify interrupting.
   */
  private async checkGoalPreemption(): Promise<void> {
    if (!this.currentWorldState || !this.arbiter || !this.executor) return;

    const currentGoal = this.arbiter.getCurrentGoal();
    if (!currentGoal) return;

    // Get current goal's utility with current world state
    const currentIsValid = currentGoal.isValid ? currentGoal.isValid(this.currentWorldState) : true;
    const currentUtility = currentIsValid ? currentGoal.getUtility(this.currentWorldState) : 0;

    // Build skip set from cooldowns
    const now = Date.now();
    const goalsOnCooldown = new Set<string>();
    for (const [goalName, expiry] of this.failedGoalCooldowns) {
      if (now < expiry) {
        goalsOnCooldown.add(goalName);
      }
    }

    // Find the best available goal (without actually switching)
    let bestGoal: Goal | null = null;
    let bestUtility = 0;

    for (const goal of this.getGoals()) {
      // Skip current goal, goals on cooldown, and invalid goals
      if (goal === currentGoal) continue;
      if (goalsOnCooldown.has(goal.name)) continue;
      if (goal.isValid && !goal.isValid(this.currentWorldState)) continue;

      const utility = goal.getUtility(this.currentWorldState);
      if (utility > bestUtility) {
        bestUtility = utility;
        bestGoal = goal;
      }
    }

    // Check if best goal should preempt current action
    // Requires significantly higher utility to justify interruption
    if (bestGoal && bestUtility > currentUtility + GOAPRole.PREEMPTION_UTILITY_THRESHOLD) {
      this.log?.info(
        {
          currentGoal: currentGoal.name,
          currentUtility: currentUtility.toFixed(1),
          preemptingGoal: bestGoal.name,
          preemptingUtility: bestUtility.toFixed(1),
        },
        'Goal preemption: higher priority goal interrupting'
      );

      // Cancel current execution and clear goal so planNextGoal picks the new one
      this.executor.cancel(ReplanReason.WORLD_CHANGED);
      this.arbiter.clearCurrentGoal();

      // Immediately plan for the new goal
      await this.planNextGoal();
    }
  }

  /**
   * Check if we should attempt hole escape after repeated planning failures.
   * Called when planning fails - if we're stuck in a hole, planning will keep
   * failing because we can't path to resources.
   */
  private async checkHoleEscapeOnPlanningFailure(): Promise<void> {
    if (!this.bot) return;

    const now = Date.now();

    // Reset counter if too much time passed (bot was doing other things)
    if (now - this.lastPlanningFailureTime > 30000) {
      this.consecutivePlanningFailures = 0;
    }

    this.consecutivePlanningFailures++;
    this.lastPlanningFailureTime = now;

    // After 3 consecutive planning failures, check if we're in a hole
    if (this.consecutivePlanningFailures >= 3) {
      if (isInHole(this.bot)) {
        this.log?.warn(
          { failures: this.consecutivePlanningFailures },
          'Bot stuck in hole (planning failures), attempting escape'
        );

        try {
          const escaped = await escapeFromHole(this.bot, this.log);
          if (escaped) {
            this.log?.info('Successfully escaped from hole');
            this.consecutivePlanningFailures = 0;
            // Also reset the blackboard stuck tracker if present
            if (this.blackboard?.stuckTracker) {
              resetStuckTracker(this.blackboard.stuckTracker);
            }
          }
        } catch (err) {
          this.log?.warn({ err }, 'Hole escape attempt failed');
        }
      }
    }
  }

  /**
   * Handle replan requests from the executor.
   */
  private handleReplanRequest(reason: ReplanReason): void {
    // Check if there were failures during plan execution
    const hadFailures = this.executor?.hadRecentFailures() ?? false;

    this.log?.info({ reason, hadFailures }, 'Replan requested');

    // Check for hole escape on action failures
    if (this.bot && hadFailures && this.blackboard?.stuckTracker) {
      const shouldAttemptEscape = recordPathfindingFailure(
        this.blackboard.stuckTracker,
        this.bot.entity.position,
        3 // threshold
      );

      if (shouldAttemptEscape && isInHole(this.bot)) {
        this.log?.warn('Bot appears stuck in a hole, attempting escape');
        // Attempt escape asynchronously (don't block replan)
        escapeFromHole(this.bot, this.log).then(escaped => {
          if (escaped) {
            this.log?.info('Successfully escaped from hole');
            if (this.blackboard?.stuckTracker) {
              resetStuckTracker(this.blackboard.stuckTracker);
            }
          }
        }).catch(err => {
          this.log?.warn({ err }, 'Hole escape attempt failed');
        });
      }
    }

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
