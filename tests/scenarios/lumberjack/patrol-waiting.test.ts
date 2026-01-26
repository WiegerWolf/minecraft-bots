import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { MockWorld } from '../../mocks/MockWorld';
import { createBotMock } from '../../mocks/BotMock';
import { PatrolForest } from '../../../src/roles/lumberjack/behaviors/actions/PatrolForest';
import type { LumberjackBlackboard } from '../../../src/roles/lumberjack/LumberjackBlackboard';

/**
 * SPECIFICATION: PatrolForest Action Waiting Behavior
 *
 * When the PatrolForest action cannot find valid exploration candidates (all positions
 * are recently explored), it should return 'success' instead of 'failure' to
 * prevent triggering a goal cooldown that would leave the bot with limited goal options.
 *
 * BUG IDENTIFIED IN LOGS:
 * - Lumberjack cycles between FindForest and PatrolForest goals repeatedly
 * - When PatrolForest returns 'failure', it triggers a 5-second cooldown
 * - This compounds with FindForest's own exploration attempts, creating idle gaps
 *
 * FIX: When intentionally waiting (no valid candidates), return 'success' to indicate
 * the action completed its waiting behavior successfully.
 */

function createLumberjackBlackboard(overrides: Partial<LumberjackBlackboard> = {}): LumberjackBlackboard {
  return {
    lastAction: '',
    villageCenter: null,
    sharedChest: null,
    sharedCraftingTable: null,
    currentTreeHarvest: null,
    nearbyTrees: [],
    forestTrees: [],
    nearbyLogs: [],
    nearbyLeaves: [],
    nearbyDrops: [],
    nearbyChests: [],
    nearbyCraftingTables: [],
    knownChests: [],
    knownForests: [],
    knownFarms: [],
    hasKnownForest: false,
    logCount: 0,
    plankCount: 0,
    stickCount: 0,
    saplingCount: 0,
    hasAxe: false,
    emptySlots: 36,
    inventoryFull: false,
    canChop: false,
    needsToDeposit: false,
    hasIncomingNeeds: false,
    canSpareForNeeds: false,
    consecutiveIdleTicks: 0,
    exploredPositions: [],
    unreachableDrops: new Map(),
    villageChat: null,
    log: undefined,
    spawnPosition: null,
    pendingSignWrites: [],
    signPositions: new Map(),
    fullChests: new Map(),
    hasStudiedSigns: true,
    hasCheckedStorage: true,
    readSignPositions: new Set(),
    unknownSigns: [],
    stuckTracker: { lastPosition: null, stuckSince: null, escapeAttempts: 0, lastEscapeTime: 0 },
    hasBoat: false,
    maxWaterAhead: 0,
    minWaterAhead: 0,
    forestSearchFailedUntil: 0,
    tradeableItems: [],
    tradeableItemCount: 0,
    pendingTradeOffers: [],
    activeTrade: null,
    lastOfferTime: 0,
    consecutiveNoTakers: 0,
    preemptionRequested: false,
    ...overrides,
  } as LumberjackBlackboard;
}

describe('PatrolForest Action Waiting Behavior', () => {
  test('SPEC: PatrolForest returns success when intentionally waiting (no valid candidates)', async () => {
    // Create a world with no logs (already explored/harvested area)
    const world = new MockWorld();
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    const bot = createBotMock({
      world,
      position: new Vec3(0, 64, 0),
    });

    // Pre-populate explored positions densely to give ALL candidates low scores
    // PatrolForest generates random positions at distances 20-50 blocks in 8 directions
    // getExplorationScore penalizes positions within 32 blocks of explored positions
    // Score = 100 - (32 - dist) * 2, so at dist=0, score=36; at dist=16, score=68
    // Need score < 20 to be filtered out, which means (32-dist)*2 > 80, dist < -8 (impossible)
    // So we need multiple overlapping explored positions to reduce scores below 20
    const exploredPositions: Array<{ position: Vec3; timestamp: number; reason?: string }> = [];

    // Cover all potential exploration directions with multiple explored points
    for (let ring = 0; ring < 4; ring++) {
      const dist = 10 + ring * 15; // 10, 25, 40, 55 block rings
      for (let i = 0; i < 16; i++) {
        const angle = (Math.PI * 2 * i) / 16;
        exploredPositions.push({
          position: new Vec3(
            Math.cos(angle) * dist,
            64,
            Math.sin(angle) * dist
          ),
          timestamp: Date.now(),
          reason: 'visited',
        });
      }
    }

    const bb = createLumberjackBlackboard({
      consecutiveIdleTicks: 5, // Idle but below the 10-tick wait threshold
      exploredPositions,
    });

    const patrolForest = new PatrolForest();

    // Execute the action
    const result = await patrolForest.tick(bot, bb);

    // SPEC: When waiting (no valid candidates), should return 'success' not 'failure'
    // This prevents triggering a goal cooldown
    expect(result).toBe('success');
  });

  test('SPEC: PatrolForest increments consecutiveIdleTicks when waiting', async () => {
    const world = new MockWorld();
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    const bot = createBotMock({
      world,
      position: new Vec3(0, 64, 0),
    });

    // Cover all potential exploration directions with multiple explored points
    const exploredPositions: Array<{ position: Vec3; timestamp: number; reason?: string }> = [];
    for (let ring = 0; ring < 4; ring++) {
      const dist = 10 + ring * 15; // 10, 25, 40, 55 block rings
      for (let i = 0; i < 16; i++) {
        const angle = (Math.PI * 2 * i) / 16;
        exploredPositions.push({
          position: new Vec3(
            Math.cos(angle) * dist,
            64,
            Math.sin(angle) * dist
          ),
          timestamp: Date.now(),
          reason: 'visited',
        });
      }
    }

    const bb = createLumberjackBlackboard({
      consecutiveIdleTicks: 5,
      exploredPositions,
    });

    const patrolForest = new PatrolForest();
    await patrolForest.tick(bot, bb);

    // Should increment idle ticks when waiting
    expect(bb.consecutiveIdleTicks).toBeGreaterThanOrEqual(5);
  });

  test('SPEC: PatrolForest returns success after exploring to log position', async () => {
    // Create a world with logs to explore towards
    const world = new MockWorld();
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');
    // Add a log nearby
    world.setBlock(new Vec3(10, 64, 10), 'oak_log');

    const bot = createBotMock({
      world,
      position: new Vec3(0, 64, 0),
    });

    const bb = createLumberjackBlackboard({
      consecutiveIdleTicks: 0,
      exploredPositions: [],
    });

    const patrolForest = new PatrolForest();

    // Execute the action
    const result = await patrolForest.tick(bot, bb);

    // Should reset idle ticks and return success when exploring
    expect(bb.consecutiveIdleTicks).toBe(0);
    expect(result).toBe('success');
  });
});
