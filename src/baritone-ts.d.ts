/**
 * Type augmentation for baritone-ts pathfinder extension of mineflayer Bot
 */

import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Vec3 } from 'vec3';
import type {
  Goal,
  CalculationContextInterface,
  PathResult,
  // Processes
  MineProcess,
  FollowProcess,
  ExploreProcess,
  GatherProcess,
  FarmProcess,
  BuildProcess,
  CombatProcess,
  ProcessManager,
  // Chains
  FoodChain,
  WorldSurvivalChain,
  MLGBucketChain,
  MobDefenseChain,
  // Trackers
  BlockTracker,
  EntityTracker,
  ItemStorageTracker,
  TrackerManager,
  // Task system
  TaskRunner,
} from 'baritone-ts';

declare module 'mineflayer' {
  interface Bot {
    pathfinder: BaritonePathfinder;
  }
}

/**
 * Baritone-TS Pathfinder API
 *
 * Provides advanced pathfinding, automation processes, survival chains,
 * and tracking systems for Minecraft bots.
 */
export interface BaritonePathfinder {
  // ============================================================================
  // Core Pathfinding
  // ============================================================================

  /** Calculation context with settings and block data */
  readonly ctx: CalculationContextInterface;

  /** Set the current goal. Use dynamic=true for moving targets (entities). */
  setGoal(goal: Goal | null, dynamic?: boolean): void;

  /** Get the current goal */
  getGoal(): Goal | null;

  /** Calculate a path to the goal without executing it */
  getPathTo(goal: Goal): PathResult;

  /** Calculate a path from a specific start position to a goal */
  getPathFromTo(start: Vec3, goal: Goal): PathResult;

  /** Navigate to a goal (async, resolves when reached) */
  goto(goal: Goal): Promise<void>;

  /** Stop all pathfinding and clear the current goal */
  stop(): void;

  /** Check if currently executing a path */
  isMoving(): boolean;

  /** Check if currently breaking a block */
  isDigging(): boolean;

  /** Check if currently placing a block */
  isPlacing(): boolean;

  // ============================================================================
  // Process Manager (High-Level Automation)
  // ============================================================================

  /**
   * Process manager for high-level automation behaviors.
   * Only one process can be active at a time.
   *
   * Available processes:
   * - MineProcess: Find and mine specific blocks
   * - FollowProcess: Follow a moving entity
   * - ExploreProcess: Explore unknown terrain
   * - GatherProcess: Collect dropped items
   * - FarmProcess: Harvest and replant crops
   * - BuildProcess: Build structures from blueprints
   * - CombatProcess: Handle combat with mobs/players
   */
  readonly processManager?: ProcessManager;

  // ============================================================================
  // Tracker Manager (Efficient World Queries)
  // ============================================================================

  /**
   * Tracker manager for efficient world state queries.
   *
   * Trackers:
   * - BlockTracker: Find blocks by type with caching
   * - EntityTracker: Track entities by category (hostile, passive, etc.)
   * - ItemStorageTracker: Track container contents
   */
  readonly trackers?: TrackerManager;

  // ============================================================================
  // Task Runner (Hierarchical Task System)
  // ============================================================================

  /**
   * Task runner for complex automation workflows.
   * Manages task chains with priorities and survival behaviors.
   *
   * Built-in chains (auto-enabled):
   * - FoodChain: Auto-eat when hungry
   * - MobDefenseChain: Handle hostile mobs
   * - MLGBucketChain: Water bucket fall protection
   * - WorldSurvivalChain: Escape hazards (lava, fire, suffocation)
   * - DeathMenuChain: Auto-respawn
   */
  readonly taskRunner?: TaskRunner;

  // ============================================================================
  // Settings
  // ============================================================================

  /** Think timeout in milliseconds */
  readonly thinkTimeout: number;

  /** Per-tick computation timeout in milliseconds */
  readonly tickTimeout: number;

  // ============================================================================
  // Events
  // ============================================================================

  on(event: 'goal_reached', listener: (goal: Goal) => void): void;
  on(event: 'path_update', listener: (result: PathResult) => void): void;
  on(event: 'path_reset', listener: (reason: string) => void): void;
  on(event: 'path_stop', listener: () => void): void;
}

// ============================================================================
// Re-export commonly used types for convenience
// ============================================================================

export type {
  Goal,
  PathResult,
  CalculationContextInterface as CalculationContext,
  // Processes
  MineProcess,
  FollowProcess,
  ExploreProcess,
  GatherProcess,
  FarmProcess,
  BuildProcess,
  CombatProcess,
  ProcessManager,
  // Chains
  FoodChain,
  WorldSurvivalChain,
  MLGBucketChain,
  MobDefenseChain,
  // Trackers
  BlockTracker,
  EntityTracker,
  ItemStorageTracker,
  TrackerManager,
  // Task system
  TaskRunner,
} from 'baritone-ts';
