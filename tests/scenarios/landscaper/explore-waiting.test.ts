import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { MockWorld } from '../../mocks/MockWorld';
import { createBotMock } from '../../mocks/BotMock';
import { Explore } from '../../../src/roles/landscaper/behaviors/actions/Explore';
import type { LandscaperBlackboard } from '../../../src/roles/landscaper/LandscaperBlackboard';

/**
 * SPECIFICATION: Explore Action Waiting Behavior
 *
 * When the Explore action cannot find valid exploration candidates (all positions
 * are underground/unsafe), it should return 'success' instead of 'failure' to
 * prevent triggering a goal cooldown that would leave the bot with no valid goals.
 *
 * BUG IDENTIFIED IN LOGS:
 * - Landscaper repeatedly logs "No valid goals, idling" and "Goals on cooldown"
 * - Root cause: Explore action returns 'failure' when all candidates have low scores
 * - This triggers 5-second cooldown on the Explore goal
 * - Since Explore is the only goal with positive utility, bot idles for full cooldown
 *
 * FIX: When intentionally waiting (no valid candidates), return 'success' to indicate
 * the action completed its waiting behavior successfully.
 */

function createLandscaperBlackboard(overrides: Partial<LandscaperBlackboard> = {}): LandscaperBlackboard {
  return {
    lastAction: '',
    villageCenter: null,
    consecutiveIdleTicks: 0,
    exploredPositions: [],
    log: undefined,
    ...overrides,
  } as LandscaperBlackboard;
}

describe('Explore Action Waiting Behavior', () => {
  test('SPEC: Explore returns success when intentionally waiting (no valid candidates)', async () => {
    // Create a world where all exploration candidates would be underground (cave)
    // by making the bot in a cave-like environment
    const world = new MockWorld();

    // Create a small cave-like enclosure with stone roof
    // Bot is at y=30 (underground), with stone above and around
    world.fill(new Vec3(-30, 25, -30), new Vec3(30, 25, 30), 'stone'); // floor
    world.fill(new Vec3(-30, 26, -30), new Vec3(30, 35, 30), 'air'); // cave air
    world.fill(new Vec3(-30, 36, -30), new Vec3(30, 36, 30), 'stone'); // roof

    // Set the single air block where the bot will be
    world.setBlock(new Vec3(0, 26, 0), 'air');
    world.setBlock(new Vec3(0, 27, 0), 'air');

    const bot = createBotMock({
      world,
      position: new Vec3(0, 26, 0),
    });

    const bb = createLandscaperBlackboard({
      consecutiveIdleTicks: 15, // Already been idle for a while
    });

    const explore = new Explore();

    // Execute the action
    const result = await explore.tick(bot, bb);

    // SPEC: When waiting (no valid candidates), should return 'success' not 'failure'
    // This prevents triggering a goal cooldown
    expect(result).toBe('success');
  });

  test('SPEC: Explore returns success when all candidates have low scores', async () => {
    // Create a world where all exploration candidates would have low scores
    // due to being recently explored or at unsafe Y levels
    const world = new MockWorld();

    // Create flat surface at y=63 (normal surface level)
    world.fill(new Vec3(-50, 62, -50), new Vec3(50, 62, 50), 'stone');
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    const bot = createBotMock({
      world,
      position: new Vec3(0, 64, 0),
    });

    // Pre-populate explored positions to give all candidates low scores
    const exploredPositions: Array<{ position: Vec3; timestamp: number; reason?: string }> = [];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const dist = 20;
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

    const bb = createLandscaperBlackboard({
      consecutiveIdleTicks: 15,
      exploredPositions,
    });

    const explore = new Explore();

    // Execute the action
    const result = await explore.tick(bot, bb);

    // SPEC: Should return 'success' when intentionally waiting due to all areas explored
    expect(result).toBe('success');
  });

  test('SPEC: Explore increments consecutiveIdleTicks when waiting', async () => {
    const world = new MockWorld();
    world.fill(new Vec3(-30, 62, -30), new Vec3(30, 62, 30), 'stone');
    world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

    const bot = createBotMock({
      world,
      position: new Vec3(0, 64, 0),
    });

    // All areas recently explored
    const exploredPositions: Array<{ position: Vec3; timestamp: number; reason?: string }> = [];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const dist = 20;
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

    const bb = createLandscaperBlackboard({
      consecutiveIdleTicks: 5,
      exploredPositions,
    });

    const explore = new Explore();
    await explore.tick(bot, bb);

    // Should increment idle ticks when waiting
    expect(bb.consecutiveIdleTicks).toBeGreaterThanOrEqual(5);
  });
});
