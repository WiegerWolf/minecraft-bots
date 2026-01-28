#!/usr/bin/env bun
/**
 * Farmer Follow Lumberjack Simulation Tests
 *
 * SPECIFICATION: Farmer should follow lumberjack during exploration phase
 *
 * Issue being tested:
 * When the lumberjack moves far away (beyond render distance ~128 blocks),
 * the farmer loses the ability to track the lumberjack's position because
 * `player.entity` becomes null for players outside render distance.
 *
 * This results in the farmer getting stuck - they know the lumberjack exists
 * (from bot.players) but can't get their position to pathfind toward them.
 *
 * Expected behavior (current, broken):
 * - Farmer stays stuck, repeatedly logging "Lumberjack out of render distance"
 *
 * Expected behavior (after fix):
 * - Farmer should be able to catch up to lumberjack using last known position
 *   or VillageChat position broadcasts
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import type { Bot } from 'mineflayer';
import { PaperSimulationServer } from '../PaperSimulationServer';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';
import { createTestLogger } from '../../../src/shared/logger';
import { getTestSessionId, initTestSession } from '../SimulationTest';

// @ts-ignore
import mineflayer from 'mineflayer';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

/**
 * Multi-bot test harness for farmer-lumberjack coordination tests.
 */
class FollowLumberjackTest {
  readonly name: string;
  private server: PaperSimulationServer | null = null;
  private bots: Map<string, Bot> = new Map();
  private roles: Map<string, GOAPLumberjackRole | GOAPFarmingRole> = new Map();
  private assertions: Array<{ description: string; passed: boolean; error?: string }> = [];
  private startTime: number = 0;
  private failed: boolean = false;
  private _sessionId: string;

  constructor(name: string) {
    this.name = name;
    this._sessionId = getTestSessionId();
  }

  createRoleLogger(roleName: string) {
    const testNameKebab = this.name.replace(/\s+/g, '-').toLowerCase();
    const result = createTestLogger({
      botName: roleName,
      role: roleName.toLowerCase(),
      roleLabel: testNameKebab,
      sessionId: this._sessionId,
    });
    return result.logger;
  }

  async setup(world: MockWorld): Promise<void> {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`TEST: ${this.name}`);
    console.log(`${'─'.repeat(60)}\n`);

    this.startTime = Date.now();
    this.assertions = [];
    this.failed = false;

    this.server = new PaperSimulationServer();

    console.log('[FollowLumberjackTest] Starting server and building world...');

    // Use a temporary bot to set up the world
    const tempBot = await this.server.start(world, {
      openBrowser: false,
      enableViewer: true,
      botPosition: new Vec3(0, 65, 0),
      botInventory: [],
    });

    tempBot.quit();
    await this.delay(1000);
  }

  async addBot(
    name: string,
    position: Vec3,
    inventory: Array<{ name: string; count: number }> = []
  ): Promise<Bot> {
    if (!this.server) throw new Error('Test not set up');

    console.log(`[FollowLumberjackTest] Adding bot: ${name} at ${position}`);

    const bot = mineflayer.createBot({
      host: 'localhost',
      port: 25566,
      username: name,
      version: '1.21.6',
      auth: 'offline',
    });

    await new Promise<void>((resolve, reject) => {
      bot.once('spawn', () => resolve());
      bot.once('error', reject);
      bot.once('kicked', (reason: string) => reject(new Error(`Kicked: ${reason}`)));
    });

    pathfinder(bot as any, { canDig: true, allowParkour: true, allowSprint: true });

    await this.server.rconCommand(`tp ${name} ${position.x} ${position.y} ${position.z}`);
    await this.server.rconCommand(`clear ${name}`);
    await this.server.rconCommand(`gamemode survival ${name}`);

    for (const item of inventory) {
      await this.server.rconCommand(`give ${name} minecraft:${item.name} ${item.count}`);
    }

    this.bots.set(name, bot);
    await this.delay(500);

    return bot;
  }

  getBot(name: string): Bot {
    const bot = this.bots.get(name);
    if (!bot) throw new Error(`Bot ${name} not found`);
    return bot;
  }

  getBotPosition(name: string): Vec3 | null {
    const bot = this.bots.get(name);
    return bot?.entity?.position?.clone() || null;
  }

  distanceBetweenBots(bot1Name: string, bot2Name: string): number {
    const pos1 = this.getBotPosition(bot1Name);
    const pos2 = this.getBotPosition(bot2Name);
    if (!pos1 || !pos2) return Infinity;
    return pos1.distanceTo(pos2);
  }

  async waitUntil(
    condition: () => boolean | Promise<boolean>,
    options: { timeout?: number; interval?: number; message?: string } = {}
  ): Promise<boolean> {
    const { timeout = 30000, interval = 500, message = 'Condition not met' } = options;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        if (await condition()) {
          this.recordAssertion(message, true);
          return true;
        }
      } catch {
        // Condition threw, keep waiting
      }
      await this.delay(interval);
    }

    this.recordAssertion(message, false, `Timed out after ${timeout}ms`);
    return false;
  }

  async wait(ms: number, reason?: string): Promise<void> {
    if (reason) {
      console.log(`  ⏳ Waiting ${ms}ms: ${reason}`);
    }
    await this.delay(ms);
  }

  async rcon(command: string): Promise<string> {
    if (!this.server) throw new Error('Test not set up');
    return this.server.rconCommand(command);
  }

  assert(condition: boolean, message: string): boolean {
    this.recordAssertion(message, condition);
    return condition;
  }

  /**
   * Assert that current behavior matches expected broken behavior.
   * This test documents the bug - it passes when the bug exists.
   * After the fix, this assertion should be updated to expect the fixed behavior.
   */
  assertBrokenBehavior(condition: boolean, message: string): boolean {
    this.recordAssertion(`[EXPECTED BUG] ${message}`, condition);
    return condition;
  }

  async cleanup(): Promise<TestResult> {
    const duration = Date.now() - this.startTime;
    const passed = !this.failed && this.assertions.every(a => a.passed);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`RESULT: ${passed ? '✅ PASSED' : '❌ FAILED'} (${(duration / 1000).toFixed(1)}s)`);
    console.log(`${'─'.repeat(60)}`);

    for (const assertion of this.assertions) {
      console.log(`  ${assertion.passed ? '✓' : '✗'} ${assertion.description}`);
      if (!assertion.passed && assertion.error) {
        console.log(`    └─ ${assertion.error}`);
      }
    }
    console.log('');

    // Stop roles
    for (const [name, role] of this.roles) {
      const bot = this.bots.get(name);
      if (bot) {
        role.stop(bot);
      }
    }
    this.roles.clear();

    // Disconnect all bots
    for (const [name, bot] of this.bots) {
      console.log(`[FollowLumberjackTest] Disconnecting ${name}...`);
      bot.quit();
    }
    this.bots.clear();

    if (this.server) {
      await this.server.stop();
      this.server = null;
    }

    return { name: this.name, passed, duration };
  }

  private recordAssertion(description: string, passed: boolean, error?: string): void {
    this.assertions.push({ description, passed, error });
    if (!passed) {
      this.failed = true;
      console.log(`  ✗ ${description}${error ? ` (${error})` : ''}`);
    } else {
      console.log(`  ✓ ${description}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer fails to follow lumberjack when out of render distance
// ═══════════════════════════════════════════════════════════════════════════

/**
 * This test replicates the production bug where:
 * 1. Lumberjack spawns and moves to a distant forest (~200+ blocks away)
 * 2. Farmer spawns and studies signs, gathers seeds (stays near spawn)
 * 3. Farmer tries to follow lumberjack but can't get their position
 * 4. Farmer gets stuck because player.entity is null beyond render distance
 *
 * The test documents the current broken behavior:
 * - After 60 seconds, farmer should still be near spawn (hasn't followed)
 * - Distance between bots should remain large (>100 blocks)
 */
async function testFarmerFailsToFollowDistantLumberjack() {
  const test = new FollowLumberjackTest('Farmer fails to follow lumberjack out of render distance');

  // Create a large world with spawn area and distant forest
  const world = new MockWorld();

  // Ground: large area to allow distant movement
  // Spawn at (0, 64, 0), forest at (200, 64, 0) - 200 blocks away
  world.fill(new Vec3(-50, 63, -50), new Vec3(250, 63, 50), 'grass_block');

  // Village sign at spawn (both bots study this first)
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Forest far away - lumberjack will pathfind here
  const forestCenter = new Vec3(200, 64, 0);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const dist = 5 + Math.random() * 10;
    const x = Math.floor(forestCenter.x + Math.cos(angle) * dist);
    const z = Math.floor(forestCenter.z + Math.sin(angle) * dist);
    createOakTree(world, new Vec3(x, 64, z), 4 + Math.floor(Math.random() * 3));
  }

  // Water near spawn for farmer (so they have something to do)
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Some grass for seeds
  world.fill(new Vec3(-20, 64, -20), new Vec3(-5, 64, 20), 'short_grass');

  await test.setup(world);

  // Add lumberjack first - spawns at origin
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
  ]);

  // Add farmer - also spawns at origin
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(0, 65, 0), []);

  await test.wait(2000, 'Bots loading');

  // Start lumberjack role (will study signs then look for forest)
  const lumberjackRole = new GOAPLumberjackRole();
  lumberjackRole.start(lumberjackBot, {
    logger: test.createRoleLogger('lumberjack'),
    spawnPosition: new Vec3(0, 65, 0),
  });

  // Start farmer role (will study signs then try to follow lumberjack)
  const farmerRole = new GOAPFarmingRole();
  farmerRole.start(farmerBot, {
    logger: test.createRoleLogger('farmer'),
    spawnPosition: new Vec3(0, 65, 0),
  });

  // Wait for lumberjack to move toward forest
  // The lumberjack should find the forest and start moving there
  await test.waitUntil(
    () => {
      const lmbrPos = test.getBotPosition('Test_Lmbr');
      return lmbrPos !== null && lmbrPos.x > 50;
    },
    {
      timeout: 90000,
      message: 'Lumberjack should start moving toward distant forest',
    }
  );

  // Record positions at this point
  const lmbrPosAfterMove = test.getBotPosition('Test_Lmbr');
  const farmerPosAfterMove = test.getBotPosition('Test_Farmer');
  console.log(`  📍 Lumberjack position: ${lmbrPosAfterMove}`);
  console.log(`  📍 Farmer position: ${farmerPosAfterMove}`);

  // Wait more time for farmer to potentially follow
  await test.wait(30000, 'Giving farmer time to follow (or fail to follow)');

  // Check final positions
  const finalDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Farmer');
  const farmerFinalPos = test.getBotPosition('Test_Farmer');
  const lmbrFinalPos = test.getBotPosition('Test_Lmbr');

  console.log(`  📍 Final lumberjack position: ${lmbrFinalPos}`);
  console.log(`  📍 Final farmer position: ${farmerFinalPos}`);
  console.log(`  📏 Final distance between bots: ${finalDistance.toFixed(1)} blocks`);

  // Document the bug: farmer should have stayed near spawn (didn't follow)
  // This assertion passes when the bug exists
  test.assertBrokenBehavior(
    farmerFinalPos !== null && farmerFinalPos.x < 50,
    'Farmer stayed near spawn (failed to follow lumberjack)'
  );

  test.assertBrokenBehavior(
    finalDistance > 100,
    `Bots are far apart (${finalDistance.toFixed(1)} blocks) - farmer couldn't catch up`
  );

  // After fix, change these to:
  // test.assert(farmerFinalPos !== null && farmerFinalPos.x > 100, 'Farmer followed lumberjack toward forest');
  // test.assert(finalDistance < 50, 'Farmer caught up to lumberjack');

  lumberjackRole.stop(lumberjackBot);
  farmerRole.stop(farmerBot);

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer can follow lumberjack when in render distance (baseline)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Baseline test: Farmer CAN follow lumberjack when they stay close.
 * This proves the FollowLumberjack goal works when render distance isn't an issue.
 */
async function testFarmerFollowsNearbyLumberjack() {
  const test = new FollowLumberjackTest('Farmer follows lumberjack when in render distance');

  const world = new MockWorld();

  // Smaller world - forest is close (30 blocks away, within render distance)
  world.fill(new Vec3(-30, 63, -30), new Vec3(60, 63, 30), 'grass_block');

  // Village sign at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Forest nearby - within render distance
  const forestCenter = new Vec3(40, 64, 0);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const dist = 3 + Math.random() * 5;
    const x = Math.floor(forestCenter.x + Math.cos(angle) * dist);
    const z = Math.floor(forestCenter.z + Math.sin(angle) * dist);
    createOakTree(world, new Vec3(x, 64, z), 4 + Math.floor(Math.random() * 2));
  }

  // Some grass for seeds
  world.fill(new Vec3(-15, 64, -15), new Vec3(-5, 64, 15), 'short_grass');

  await test.setup(world);

  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
  ]);

  const farmerBot = await test.addBot('Test_Farmer', new Vec3(0, 65, 0), []);

  await test.wait(2000, 'Bots loading');

  const lumberjackRole = new GOAPLumberjackRole();
  lumberjackRole.start(lumberjackBot, {
    logger: test.createRoleLogger('lumberjack'),
    spawnPosition: new Vec3(0, 65, 0),
  });

  const farmerRole = new GOAPFarmingRole();
  farmerRole.start(farmerBot, {
    logger: test.createRoleLogger('farmer'),
    spawnPosition: new Vec3(0, 65, 0),
  });

  // Wait for lumberjack to reach forest
  await test.waitUntil(
    () => {
      const lmbrPos = test.getBotPosition('Test_Lmbr');
      return lmbrPos !== null && lmbrPos.x > 30;
    },
    {
      timeout: 60000,
      message: 'Lumberjack should reach nearby forest',
    }
  );

  // Give farmer time to follow
  await test.wait(20000, 'Giving farmer time to follow');

  const finalDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Farmer');
  const farmerFinalPos = test.getBotPosition('Test_Farmer');

  console.log(`  📍 Final farmer position: ${farmerFinalPos}`);
  console.log(`  📏 Final distance between bots: ${finalDistance.toFixed(1)} blocks`);

  // When lumberjack is in render distance, farmer should follow successfully
  test.assert(
    farmerFinalPos !== null && farmerFinalPos.x > 15,
    'Farmer moved toward lumberjack (following works in render distance)'
  );

  test.assert(
    finalDistance < 50,
    `Farmer stayed close to lumberjack (${finalDistance.toFixed(1)} blocks)`
  );

  lumberjackRole.stop(lumberjackBot);
  farmerRole.stop(farmerBot);

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'out-of-range': testFarmerFailsToFollowDistantLumberjack,
  'in-range': testFarmerFollowsNearbyLumberjack,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('FARMER FOLLOW LUMBERJACK SIMULATION TESTS');
  console.log(`Session: ${sessionId}`);
  console.log('═'.repeat(60) + '\n');

  for (const testFn of tests) {
    try {
      const result = await testFn();
      results.push(result);
      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      console.error('Test error:', err);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`Logs: logs/${sessionId}/`);
  console.log('═'.repeat(60) + '\n');

  return { passed, failed };
}

async function main() {
  const testName = process.argv[2];

  if (testName === '--list' || testName === '-l') {
    console.log('Available tests:', Object.keys(ALL_TESTS).join(', '));
    process.exit(0);
  }

  let testsToRun: Array<() => Promise<TestResult>>;

  if (testName && ALL_TESTS[testName]) {
    testsToRun = [ALL_TESTS[testName]];
  } else if (testName) {
    console.error(`Unknown test: ${testName}`);
    console.log('Available tests:', Object.keys(ALL_TESTS).join(', '));
    process.exit(1);
  } else {
    testsToRun = Object.values(ALL_TESTS);
  }

  const { failed } = await runTests(testsToRun);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
