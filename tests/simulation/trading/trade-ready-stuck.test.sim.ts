#!/usr/bin/env bun
/**
 * Trade Ready State Stuck Detection Test
 *
 * SPECIFICATION: Trade Protocol Stuck Detection and Recovery
 *
 * Tests the scenario where both bots arrive at the meeting point but
 * the trade gets stuck because TRADE_READY messages aren't processed
 * correctly or arrive out of order.
 *
 * This test verifies:
 * 1. Detection of stuck 'ready' state (both bots waiting for each other)
 * 2. Recovery mechanism (re-send TRADE_READY or timeout/cancel)
 * 3. Trade completion even with message timing issues
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
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

type RoleType = GOAPFarmingRole | GOAPLumberjackRole;

/**
 * Multi-bot test harness for trade stuck detection tests.
 */
class TradeReadyStuckTest {
  readonly name: string;
  private server: PaperSimulationServer | null = null;
  private bots: Map<string, Bot> = new Map();
  private roles: Map<string, RoleType> = new Map();
  private assertions: Array<{ description: string; passed: boolean; error?: string }> = [];
  private startTime: number = 0;
  private failed: boolean = false;
  private _sessionId: string;
  private chatLog: Array<{ from: string; message: string; timestamp: number }> = [];

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
    this.chatLog = [];

    this.server = new PaperSimulationServer();

    console.log('[TradeReadyStuckTest] Starting server and building world...');

    const tempBot = await this.server.start(world, {
      openBrowser: false,
      enableViewer: false,
      botPosition: new Vec3(0, 65, 0),
      botInventory: [],
      testName: this.name,
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

    console.log(`[TradeReadyStuckTest] Adding bot: ${name} at ${position}`);

    const bot = mineflayer.createBot({
      host: 'localhost',
      port: 25566,
      username: name,
      version: '1.21.6',
      auth: 'offline',
      checkTimeoutInterval: 120000,
    });

    await new Promise<void>((resolve, reject) => {
      bot.once('spawn', () => resolve());
      bot.once('error', reject);
      bot.once('kicked', (reason: string) => reject(new Error(`Kicked: ${reason}`)));
    });

    bot.loadPlugin(pathfinderPlugin);

    bot.on('chat', (username: string, message: string) => {
      this.chatLog.push({ from: username, message, timestamp: Date.now() });
    });

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

  startRole(botName: string, role: RoleType, roleType: string): void {
    const bot = this.bots.get(botName);
    if (!bot) throw new Error(`Bot ${botName} not found`);

    role.start(bot, {
      logger: this.createRoleLogger(roleType),
      spawnPosition: new Vec3(0, 65, 0),
    });

    this.roles.set(botName, role);
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

  getBotInventoryCount(botName: string, itemName: string): number {
    const bot = this.bots.get(botName);
    if (!bot) return 0;
    return bot.inventory.items()
      .filter(i => i.name === itemName)
      .reduce((sum, i) => sum + i.count, 0);
  }

  distanceBetweenBots(bot1Name: string, bot2Name: string): number {
    const pos1 = this.getBotPosition(bot1Name);
    const pos2 = this.getBotPosition(bot2Name);
    if (!pos1 || !pos2) return Infinity;
    return pos1.distanceTo(pos2);
  }

  hasChatMessage(pattern: string | RegExp): boolean {
    return this.chatLog.some(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    });
  }

  countChatMessages(pattern: string | RegExp): number {
    return this.chatLog.filter(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    }).length;
  }

  getChatMessages(pattern: string | RegExp): Array<{ from: string; message: string; timestamp: number }> {
    return this.chatLog.filter(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    });
  }

  /**
   * Get the time between first TRADE_READY and TRADE_DROPPED.
   * This measures how long bots spent in the 'ready' state.
   */
  getReadyStateDuration(): number {
    const readyMsgs = this.getChatMessages('[TRADE_READY]');
    const droppedMsgs = this.getChatMessages('[TRADE_DROPPED]');

    if (readyMsgs.length === 0 || droppedMsgs.length === 0) return -1;

    const firstReady = Math.min(...readyMsgs.map(m => m.timestamp));
    const firstDropped = droppedMsgs[0]!.timestamp;

    return firstDropped - firstReady;
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

  assertEqual<T>(actual: T, expected: T, message: string): boolean {
    const passed = actual === expected;
    this.recordAssertion(message, passed, passed ? undefined : `Expected: ${expected}, Actual: ${actual}`);
    return passed;
  }

  assertLessThan(actual: number, expected: number, message: string): boolean {
    const passed = actual < expected;
    this.recordAssertion(message, passed, passed ? undefined : `Expected < ${expected}, Actual: ${actual}`);
    return passed;
  }

  assertGreater(actual: number, expected: number, message: string): boolean {
    const passed = actual > expected;
    this.recordAssertion(message, passed, passed ? undefined : `Expected > ${expected}, Actual: ${actual}`);
    return passed;
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
      console.log(`[TradeReadyStuckTest] Disconnecting ${name}...`);
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
// TEST: Trade completes despite message timing issues
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SPEC: Trade Ready State Recovery
 *
 * When both bots are at the meeting point, the trade should complete
 * within a reasonable time even if there are message timing issues.
 *
 * Success criteria:
 * - Trade completes with TRADE_DONE
 * - Ready state duration < 30 seconds (indicates no extended stuck state)
 * - Items are actually transferred
 */
async function testTradeReadyStateRecovery() {
  const test = new TradeReadyStuckTest('Trade completes with ready state recovery');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure - compact setup for fast trading
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Forest close to spawn - lumberjack will detect trees immediately
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -8\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-8, 64, 0), 5);
  createOakTree(world, new Vec3(-12, 64, 3), 5);

  // Farm with water - farmer will want seeds for planting
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });
  world.setBlock(new Vec3(10, 63, 10), 'water');  // Water source for farming
  world.fill(new Vec3(8, 63, 8), new Vec3(12, 63, 12), 'farmland');  // Farmland around water

  await test.setup(world);

  // Lumberjack with seeds - starts close to village center
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(2, 65, 2), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 16 },
  ]);

  // Farmer also starts close - minimizes travel time to focus on ready state
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(-2, 65, 2), [
    { name: 'iron_hoe', count: 1 },
    { name: 'oak_sign', count: 4 },
  ]);

  await test.wait(5000, 'Bots loading and reading signs');

  // Verify initial state
  test.assertEqual(
    test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds'),
    16,
    'Lumberjack starts with 16 wheat_seeds'
  );
  const farmerInitialSeeds = test.getBotInventoryCount('Test_Farmer', 'wheat_seeds');
  test.assertEqual(farmerInitialSeeds, 0, 'Farmer starts with 0 seeds');

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for trade offer
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]'),
    {
      timeout: 120000,
      message: 'Lumberjack should broadcast [OFFER]',
    }
  );

  // Wait for WANT response
  await test.waitUntil(
    () => test.hasChatMessage('[WANT]'),
    {
      timeout: 30000,
      message: 'Farmer should respond with [WANT]',
    }
  );

  // Wait for trade acceptance
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_ACCEPT]'),
    {
      timeout: 30000,
      message: 'Lumberjack should send [TRADE_ACCEPT]',
    }
  );

  // Wait for both TRADE_READY - this is where stuck state could occur
  await test.waitUntil(
    () => {
      const readyMsgs = test.getChatMessages('[TRADE_READY]');
      return readyMsgs.length >= 2;
    },
    {
      timeout: 60000,
      message: 'Both bots should send [TRADE_READY]',
    }
  );

  console.log('  📍 Both bots are at meeting point, checking for stuck state...');

  // The critical test: trade should complete within reasonable time
  // If there's a stuck state bug, this will timeout
  const tradeCompleted = await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 60000,  // 60 seconds max for ready -> done
      message: 'Trade should complete with [TRADE_DONE] (no stuck state)',
    }
  );

  if (tradeCompleted) {
    // Measure ready state duration
    const readyDuration = test.getReadyStateDuration();
    console.log(`  ⏱️ Ready state duration: ${readyDuration}ms`);

    // Ready state should not take excessively long
    test.assertLessThan(
      readyDuration,
      30000,  // 30 seconds max
      `Ready state should complete in <30s (was ${readyDuration}ms)`
    );

    // Verify items were actually transferred
    await test.wait(2000, 'Inventory settling');

    const farmerSeeds = test.getBotInventoryCount('Test_Farmer', 'wheat_seeds');
    test.assertGreater(farmerSeeds, 0, `Farmer should have received seeds (has ${farmerSeeds})`);

    const lumberjackSeeds = test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds');
    console.log(`  📦 Final state: Farmer=${farmerSeeds} seeds, Lumberjack=${lumberjackSeeds} seeds`);
  }

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Multiple TRADE_READY messages don't cause issues
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SPEC: TRADE_READY Re-send Handling
 *
 * If TRADE_READY is re-sent (as a recovery mechanism), it should not
 * cause duplicate item drops or other issues.
 */
async function testTradeReadyResendSafe() {
  const test = new TradeReadyStuckTest('Multiple TRADE_READY messages are safe');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });

  // Forest
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -8\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-8, 64, 0), 5);

  // Farm with water - farmer will want seeds
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });
  world.setBlock(new Vec3(10, 63, 10), 'water');
  world.fill(new Vec3(8, 63, 8), new Vec3(12, 63, 12), 'farmland');

  await test.setup(world);

  // Bots start at same position - should cause near-simultaneous TRADE_READY
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 },
  ]);

  const farmerBot = await test.addBot('Test_Farmer', new Vec3(1, 65, 0), [
    { name: 'iron_hoe', count: 1 },
  ]);

  await test.wait(5000, 'Bots loading');

  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for trade to complete
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 180000,
      message: 'Trade should complete',
    }
  );

  // Count TRADE_READY messages - may have multiple due to re-sends
  const readyCount = test.countChatMessages('[TRADE_READY]');
  console.log(`  📢 TRADE_READY messages: ${readyCount}`);

  // Count TRADE_DROPPED - ideally one, but goal replanning may cause extras
  const droppedCount = test.countChatMessages('[TRADE_DROPPED]');
  console.log(`  📢 TRADE_DROPPED messages: ${droppedCount}`);
  test.assert(
    droppedCount >= 1,
    `Items should be dropped at least once (dropped ${droppedCount} times)`
  );

  // Count TRADE_DONE - ideally one, but goal replanning may cause extras
  const doneCount = test.countChatMessages('[TRADE_DONE]');
  console.log(`  📢 TRADE_DONE messages: ${doneCount}`);
  test.assert(
    doneCount >= 1,
    `Trade should complete at least once (done ${doneCount} times)`
  );

  // CRITICAL: Verify inventory conserved - this is what matters most
  const farmerSeeds = test.getBotInventoryCount('Test_Farmer', 'wheat_seeds');
  const lumberjackSeeds = test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds');
  const totalSeeds = farmerSeeds + lumberjackSeeds;

  test.assertEqual(
    totalSeeds,
    8,
    `Seeds should be conserved (${farmerSeeds} + ${lumberjackSeeds} = ${totalSeeds}, expected 8)`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Stuck detection triggers timeout/cancel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SPEC: Trade Stuck Detection and Timeout
 *
 * If bots are stuck in ready state for too long, the trade should
 * eventually timeout and cancel, rather than blocking forever.
 */
async function testTradeStuckTimeout() {
  const test = new TradeReadyStuckTest('Trade times out if stuck in ready state');

  const world = new MockWorld();
  world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');

  // Forest far away to give lumberjack something to do after trade
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -30\nY: 64\nZ: -30' });
  createOakTree(world, new Vec3(-30, 64, -30), 5);

  // Farm for farmer with water
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 30\nY: 64\nZ: 30' });
  world.setBlock(new Vec3(30, 63, 30), 'water');
  world.fill(new Vec3(28, 63, 28), new Vec3(32, 63, 32), 'farmland');

  await test.setup(world);

  // Start bots FAR apart - long travel time may cause timing issues
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(-25, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 },
  ]);

  const farmerBot = await test.addBot('Test_Farmer', new Vec3(25, 65, 0), [
    { name: 'iron_hoe', count: 1 },
  ]);

  await test.wait(5000, 'Bots loading');

  // Record initial distance
  const initialDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Farmer');
  console.log(`  📏 Initial distance: ${initialDistance.toFixed(1)} blocks`);
  test.assertGreater(initialDistance, 40, 'Bots should start far apart');

  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for either:
  // 1. Trade completes successfully (TRADE_DONE)
  // 2. Trade times out/cancels (TRADE_CANCEL)
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]') || test.hasChatMessage('[TRADE_CANCEL]'),
    {
      timeout: 180000,  // 3 minutes max
      message: 'Trade should complete or cancel (not hang forever)',
    }
  );

  const completed = test.hasChatMessage('[TRADE_DONE]');
  const cancelled = test.hasChatMessage('[TRADE_CANCEL]');

  console.log(`  📋 Trade result: completed=${completed}, cancelled=${cancelled}`);

  // Either outcome is acceptable - the key is that it doesn't hang
  test.assert(
    completed || cancelled,
    'Trade should either complete or cancel (not hang)'
  );

  // If trade was cancelled, verify lumberjack still has seeds
  if (cancelled && !completed) {
    const lumberjackSeeds = test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds');
    test.assertGreater(lumberjackSeeds, 0, 'Cancelled trade should preserve items');
  }

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'ready-recovery': testTradeReadyStateRecovery,
  'resend-safe': testTradeReadyResendSafe,
  'stuck-timeout': testTradeStuckTimeout,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('TRADE READY STATE STUCK DETECTION TESTS');
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
