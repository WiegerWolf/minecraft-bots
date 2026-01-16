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
   */
  private checkPreconditions(action: GOAPAction, state: WorldState): boolean {
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
   * Simple heuristic: count unsatisfied goal conditions.
   */
  private heuristic(state: WorldState, goal: Goal): number {
    let unsatisfied = 0;
    for (const condition of goal.conditions) {
      const value = state.get(condition.key);
      if (!condition.check(value)) {
        unsatisfied++;
      }
    }
    return unsatisfied;
  }

  /**
   * Generate a unique key for a state (for closed set checking).
   * Uses a subset of important facts to avoid false negatives.
   */
  private getStateKey(state: WorldState): string {
    // Only include facts that are likely to be affected by actions
    const importantFacts = [
      'has.hoe', 'has.sword', 'has.axe', 'has.craftingTable',
      'inv.seeds', 'inv.produce', 'inv.logs', 'inv.planks', 'inv.sticks',
      'nearby.matureCrops', 'nearby.farmland', 'nearby.drops',
      'tree.active', 'derived.hasFarmEstablished',
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
