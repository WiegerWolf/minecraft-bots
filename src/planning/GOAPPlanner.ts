import type { GOAPAction } from './Action';
import type { Goal } from './Goal';
import { WorldState } from './WorldState';

/**
 * A node in the planning search tree.
 */
interface PlanNode {
  state: WorldState;
  action: GOAPAction | null; // null for root node
  parent: PlanNode | null;
  gCost: number; // Cost from start to this node
  hCost: number; // Heuristic cost from this node to goal
  fCost: number; // Total cost (g + h)
}

/**
 * Result of planning.
 */
export interface PlanResult {
  success: boolean;
  plan: GOAPAction[]; // Sequence of actions to achieve goal
  cost: number; // Total cost of the plan
  nodesExplored: number; // Stats for debugging
}

/**
 * Configuration for the planner.
 */
export interface GOAPPlannerConfig {
  maxIterations: number; // Prevent infinite loops
  debug: boolean;
}

/**
 * GOAP Planner using A* search.
 * Finds an optimal sequence of actions to achieve a goal.
 */
export class GOAPPlanner {
  private actions: GOAPAction[];
  private config: GOAPPlannerConfig;

  constructor(actions: GOAPAction[], config?: Partial<GOAPPlannerConfig>) {
    this.actions = actions;
    this.config = {
      maxIterations: config?.maxIterations ?? 1000,
      debug: config?.debug ?? false,
    };
  }

  /**
   * Plan a sequence of actions to achieve the goal from the current state.
   */
  plan(currentState: WorldState, goal: Goal): PlanResult {
    const startTime = Date.now();

    // Quick check: is goal already satisfied?
    if (this.isGoalSatisfied(currentState, goal)) {
      if (this.config.debug) {
        console.log(`[Planner] Goal ${goal.name} already satisfied`);
      }
      return {
        success: true,
        plan: [],
        cost: 0,
        nodesExplored: 0,
      };
    }

    // Initialize A* search
    const openSet: PlanNode[] = [];
    const closedSet = new Set<string>();

    const startNode: PlanNode = {
      state: currentState.clone(),
      action: null,
      parent: null,
      gCost: 0,
      hCost: this.heuristic(currentState, goal),
      fCost: 0,
    };
    startNode.fCost = startNode.gCost + startNode.hCost;
    openSet.push(startNode);

    let nodesExplored = 0;
    let iterations = 0;

    while (openSet.length > 0 && iterations < this.config.maxIterations) {
      iterations++;

      // Get node with lowest fCost
      openSet.sort((a, b) => a.fCost - b.fCost);
      const current = openSet.shift()!;
      nodesExplored++;

      // Check if we've reached the goal
      if (this.isGoalSatisfied(current.state, goal)) {
        const plan = this.reconstructPlan(current);
        const elapsed = Date.now() - startTime;

        if (this.config.debug) {
          console.log(
            `[Planner] Success! Found plan for ${goal.name}: ` +
            `${plan.map(a => a.name).join(' → ')} ` +
            `(cost: ${current.gCost.toFixed(1)}, nodes: ${nodesExplored}, time: ${elapsed}ms)`
          );
        }

        return {
          success: true,
          plan,
          cost: current.gCost,
          nodesExplored,
        };
      }

      // Mark as explored
      const stateKey = this.getStateKey(current.state);
      closedSet.add(stateKey);

      // Expand node: try all applicable actions
      for (const action of this.actions) {
        // Check preconditions
        if (!this.checkPreconditions(action, current.state)) {
          continue;
        }

        // Apply action to get new state
        const newState = current.state.clone();
        this.applyEffects(action, newState);

        const newStateKey = this.getStateKey(newState);
        if (closedSet.has(newStateKey)) {
          continue; // Already explored
        }

        // Calculate costs
        const gCost = current.gCost + action.getCost(current.state);
        const hCost = this.heuristic(newState, goal);
        const fCost = gCost + hCost;

        // Check if this state is already in open set with better cost
        const existingIdx = openSet.findIndex(n => this.getStateKey(n.state) === newStateKey);
        if (existingIdx >= 0) {
          const existingNode = openSet[existingIdx];
          if (existingNode && gCost < existingNode.gCost) {
            // Found better path to this state
            openSet.splice(existingIdx, 1);
          } else {
            continue; // Existing path is better
          }
        }

        // Add new node to open set
        const newNode: PlanNode = {
          state: newState,
          action,
          parent: current,
          gCost,
          hCost,
          fCost,
        };
        openSet.push(newNode);
      }
    }

    // Failed to find plan
    const elapsed = Date.now() - startTime;
    if (this.config.debug) {
      console.log(
        `[Planner] Failed to find plan for ${goal.name} ` +
        `(nodes: ${nodesExplored}, iterations: ${iterations}, time: ${elapsed}ms)`
      );
    }

    return {
      success: false,
      plan: [],
      cost: 0,
      nodesExplored,
    };
  }

  /**
   * Check if all goal conditions are satisfied.
   */
  private isGoalSatisfied(state: WorldState, goal: Goal): boolean {
    for (const condition of goal.conditions) {
      const value = state.get(condition.key);
      if (!condition.check(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if action preconditions are satisfied.
   * If the action has a custom checkPreconditions method, use that instead.
   */
  private checkPreconditions(action: GOAPAction, state: WorldState): boolean {
    // Use action's custom checkPreconditions if available (for complex OR logic)
    if ('checkPreconditions' in action && typeof (action as any).checkPreconditions === 'function') {
      return (action as any).checkPreconditions(state);
    }

    // Default: check preconditions array
    for (const precond of action.preconditions) {
      const value = state.get(precond.key);
      if (!precond.check(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Apply action effects to a state.
   */
  private applyEffects(action: GOAPAction, state: WorldState): void {
    for (const effect of action.effects) {
      const newValue = effect.apply(state);
      state.set(effect.key, newValue);
    }
  }

  /**
   * Heuristic: estimate cost from state to goal.
   *
   * For numeric conditions with target metadata, calculates the estimated
   * number of actions needed to reach the target value. This provides much
   * better A* guidance than simply counting unsatisfied conditions.
   *
   * For example, if goal is "inv.logs >= 64" and current logs = 4,
   * with estimatedDelta = 4 (logs per ChopTree), heuristic = (64-4)/4 = 15.
   */
  private heuristic(state: WorldState, goal: Goal): number {
    let totalCost = 0;

    for (const condition of goal.conditions) {
      const value = state.get(condition.key);

      if (condition.check(value)) {
        continue; // Already satisfied
      }

      // If we have numeric target metadata, calculate distance-based heuristic
      if (condition.numericTarget) {
        const currentValue = typeof value === 'number' ? value : 0;
        const target = condition.numericTarget;
        const delta = target.estimatedDelta ?? 1;

        let distance = 0;
        switch (target.comparison) {
          case 'gte':
            // Need to increase from current to target
            distance = Math.max(0, target.value - currentValue);
            break;
          case 'lte':
            // Need to decrease from current to target
            distance = Math.max(0, currentValue - target.value);
            break;
          case 'eq':
            // Need to reach exact value
            distance = Math.abs(target.value - currentValue);
            break;
        }

        // Estimate actions needed (cost per action assumed ~1-5, use 3 as average)
        const estimatedActions = Math.ceil(distance / Math.abs(delta));
        totalCost += estimatedActions * 3; // Weight by average action cost
      } else {
        // Fallback: count as 1 unsatisfied condition (default heuristic)
        totalCost += 5; // Assume ~5 cost to satisfy an unknown condition
      }
    }

    return totalCost;
  }

  /**
   * Generate a unique key for a state (for closed set checking).
   * Uses a subset of important facts to avoid false negatives.
   */
  private getStateKey(state: WorldState): string {
    // Only include facts that are likely to be affected by actions
    const importantFacts = [
      'has.hoe', 'has.sword', 'has.axe', 'has.craftingTable',
      'has.shovel', 'has.pickaxe', // Landscaper tools
      'inv.seeds', 'inv.produce', 'inv.logs', 'inv.planks', 'inv.sticks',
      'nearby.matureCrops', 'nearby.farmland', 'nearby.drops', 'nearby.trees',
      'tree.active', 'derived.hasFarmEstablished',
      'derived.hasAnyTool', 'derived.hasStorageAccess', // Derived states
      'state.consecutiveIdleTicks',
    ];

    const keyParts: string[] = [];
    for (const fact of importantFacts) {
      const value = state.get(fact);
      if (value !== null) {
        keyParts.push(`${fact}:${value}`);
      }
    }

    return keyParts.join('|');
  }

  /**
   * Reconstruct the action sequence from goal node back to start.
   */
  private reconstructPlan(goalNode: PlanNode): GOAPAction[] {
    const plan: GOAPAction[] = [];
    let current: PlanNode | null = goalNode;

    while (current !== null && current.action !== null) {
      plan.unshift(current.action); // Add to front
      current = current.parent;
    }

    return plan;
  }

  /**
   * Get all available actions.
   */
  getActions(): GOAPAction[] {
    return this.actions;
  }

  /**
   * Add a new action to the planner.
   */
  addAction(action: GOAPAction): void {
    this.actions.push(action);
  }

  /**
   * Remove an action from the planner.
   */
  removeAction(actionName: string): void {
    this.actions = this.actions.filter(a => a.name !== actionName);
  }
}
