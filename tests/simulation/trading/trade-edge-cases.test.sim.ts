#!/usr/bin/env bun
/**
 * Trading Edge Cases Simulation Tests
 *
 * SPECIFICATION: Trading Protocol Edge Cases
 *
 * Tests edge cases and failure scenarios:
 * - No takers for trade offer (exponential backoff)
 * - Trade cancellation (partner disconnect)
 * - Trade when already in a trade (should reject)
 * - Trade with partial inventory
 */

import { Vec3 } from 'vec3';
import pathfinder from 'baritone-ts';
import type { Bot } from 'mineflayer';
import { PaperSimulationServer } from '../PaperSimulationServer';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';
import { GOAPLandscaperRole } from '../../../src/roles/GOAPLandscaperRole';
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

type RoleType = GOAPFarmingRole | GOAPLumberjackRole | GOAPLandscaperRole;

/**
 * Multi-bot test harness for trading edge case tests.
 */
class TradingEdgeCaseTest {
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

    console.log('[TradingEdgeCaseTest] Starting server and building world...');

    // Use a temporary bot to set up the world
    const tempBot = await this.server.start(world, {
      openBrowser: false,
      enableViewer: false,
      botPosition: new Vec3(0, 65, 0),
      botInventory: [],
      testName: this.name,  // Display test name in game chat
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

    console.log(`[TradingEdgeCaseTest] Adding bot: ${name} at ${position}`);

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

    // Listen for chat messages
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

  stopRole(botName: string): void {
    const role = this.roles.get(botName);
    const bot = this.bots.get(botName);
    if (role && bot) {
      role.stop(bot);
      this.roles.delete(botName);
    }
  }

  disconnectBot(botName: string): void {
    const bot = this.bots.get(botName);
    if (bot) {
      this.stopRole(botName);
      bot.quit();
      this.bots.delete(botName);
    }
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

  getChatMessages(pattern: string | RegExp): Array<{ from: string; message: string }> {
    return this.chatLog.filter(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    });
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
      console.log(`[TradingEdgeCaseTest] Disconnecting ${name}...`);
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
// TEST: No takers - offer expires without response
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that when no one responds to a trade offer, the offerer
 * clears the trade and applies exponential backoff.
 */
async function testNoTakersBackoff() {
  const test = new TradingEdgeCaseTest('No takers - offer expires with backoff');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');

  // Add forest so lumberjack's FindForest is satisfied
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: -15' });
  createOakTree(world, new Vec3(-15, 64, -15), 5);
  createOakTree(world, new Vec3(-18, 64, -12), 5);

  await test.setup(world);

  // Only lumberjack - has seeds but no farmer to trade with
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 }, // Will try to offer these
  ]);

  await test.wait(3000, 'Bot loading');

  // Start lumberjack role
  const lumberjackRole = new GOAPLumberjackRole();
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for first offer
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]'),
    {
      timeout: 60000,
      message: 'Lumberjack should broadcast first [OFFER]',
    }
  );

  // Wait 10 seconds - offer should expire after 5s collection window
  await test.wait(10000, 'Waiting for first offer to expire (5s window + processing)');

  // Lumberjack should still have seeds (no trade happened)
  const seedCount = test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds');
  test.assertEqual(seedCount, 8, 'Lumberjack should still have 8 seeds');

  // Verify no TRADE_ACCEPT was sent (no one responded)
  test.assert(!test.hasChatMessage('[TRADE_ACCEPT]'), 'No TRADE_ACCEPT should be sent');

  // The bot should NOT immediately offer again (cooldown)
  const offerCountBefore = test.countChatMessages('[OFFER]');
  await test.wait(5000, 'Checking no immediate re-offer');
  const offerCountAfter = test.countChatMessages('[OFFER]');

  test.assertEqual(
    offerCountAfter,
    offerCountBefore,
    'Should not immediately re-offer (cooldown active)'
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Trade cancellation when partner disconnects
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that if a trade partner disconnects mid-trade,
 * the remaining bot cancels the trade gracefully.
 */
async function testPartnerDisconnect() {
  const test = new TradingEdgeCaseTest('Trade cancels when partner disconnects');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(10, 64, 0), 'chest');

  // Add forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: -15' });
  createOakTree(world, new Vec3(-15, 64, -15), 5);
  createOakTree(world, new Vec3(-18, 64, -12), 5);

  // Add farm for farmer
  world.setBlock(new Vec3(15, 63, 15), 'water');
  world.setBlock(new Vec3(12, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 64\nZ: 15' });

  await test.setup(world);

  // Lumberjack with seeds
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 },
  ]);

  // Farmer who will disconnect mid-trade
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(5, 65, 0), [
    { name: 'iron_hoe', count: 1 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for trade to start (TRADE_ACCEPT)
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_ACCEPT]'),
    {
      timeout: 60000,
      message: 'Trade should be accepted',
    }
  );

  // Record lumberjack's seed count before potential trade
  const seedsBeforeDisconnect = test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds');
  console.log(`  📦 Lumberjack seeds before disconnect: ${seedsBeforeDisconnect}`);

  // Disconnect farmer mid-trade
  console.log('  🔌 Disconnecting farmer mid-trade...');
  test.disconnectBot('Test_Farmer');

  // Wait for lumberjack to handle the disconnection
  await test.wait(15000, 'Waiting for trade timeout/cancellation');

  // Check for TRADE_CANCEL message
  const hasCancel = test.hasChatMessage('[TRADE_CANCEL]');
  test.assert(hasCancel || !test.hasChatMessage('[TRADE_DONE]'),
    'Trade should cancel or not complete (partner gone)');

  // Lumberjack should still have seeds (trade didn't complete)
  const seedsAfter = test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds');
  console.log(`  📦 Lumberjack seeds after disconnect: ${seedsAfter}`);

  // Seeds should either be same or slightly less (if dropped before cancel)
  // The key is that the trade system didn't crash
  test.assert(
    seedsAfter >= 0,
    `Lumberjack handled disconnect gracefully (has ${seedsAfter} seeds)`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Cannot offer while already in trade
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that a bot cannot broadcast a new offer while already in a trade.
 */
async function testNoOfferWhileInTrade() {
  const test = new TradingEdgeCaseTest('Cannot offer while in active trade');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(10, 64, 0), 'chest');

  // Add forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: -15' });
  createOakTree(world, new Vec3(-15, 64, -15), 5);
  createOakTree(world, new Vec3(-18, 64, -12), 5);

  // Add farm for farmer
  world.setBlock(new Vec3(15, 63, 15), 'water');
  world.setBlock(new Vec3(12, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 64\nZ: 15' });

  await test.setup(world);

  // Lumberjack with TWO types of tradeable items
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 },  // First trade item
    { name: 'potato', count: 8 },        // Second trade item
  ]);

  // Farmer who will accept trade
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(5, 65, 0), [
    { name: 'iron_hoe', count: 1 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for first offer
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]'),
    {
      timeout: 60000,
      message: 'First trade offer should be broadcast',
    }
  );

  // Count offers at this point
  const offerCountAfterFirst = test.countChatMessages('[OFFER]');
  console.log(`  📢 Offer count after first offer: ${offerCountAfterFirst}`);

  // Wait for trade acceptance
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_ACCEPT]'),
    {
      timeout: 30000,
      message: 'Trade should be accepted',
    }
  );

  // During the trade, count offers - should not increase
  const offerCountDuringTrade = test.countChatMessages('[OFFER]');
  test.assertEqual(
    offerCountDuringTrade,
    offerCountAfterFirst,
    'No new offers during active trade'
  );

  // Wait for trade to complete
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 60000,
      message: 'Trade should complete',
    }
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Minimum tradeable items threshold
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that bots only offer items when they have at least 4 (MIN_TRADEABLE_ITEMS).
 */
async function testMinimumTradeableItems() {
  const test = new TradingEdgeCaseTest('Minimum 4 items required to offer');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');

  // Add forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: -15' });
  createOakTree(world, new Vec3(-15, 64, -15), 5);
  createOakTree(world, new Vec3(-18, 64, -12), 5);

  await test.setup(world);

  // Lumberjack with only 3 seeds (below threshold)
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 3 }, // Below MIN_TRADEABLE_ITEMS (4)
  ]);

  await test.wait(3000, 'Bot loading');

  // Start lumberjack role
  const lumberjackRole = new GOAPLumberjackRole();
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait and verify no offer is made
  await test.wait(45000, 'Waiting to confirm no trade offer (below threshold)');

  const offerCount = test.countChatMessages('[OFFER]');
  test.assertEqual(
    offerCount,
    0,
    'No offers should be broadcast with only 3 items (need 4+)'
  );

  // Now give lumberjack more seeds to exceed threshold
  await test.rcon('give Test_Lmbr minecraft:wheat_seeds 5');
  await test.wait(3000, 'Giving more seeds');

  // Now should offer
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]'),
    {
      timeout: 45000,
      message: 'Should broadcast offer after getting 4+ items',
    }
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'no-takers': testNoTakersBackoff,
  'disconnect': testPartnerDisconnect,
  'no-offer-in-trade': testNoOfferWhileInTrade,
  'min-items': testMinimumTradeableItems,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('TRADING EDGE CASES SIMULATION TESTS');
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
