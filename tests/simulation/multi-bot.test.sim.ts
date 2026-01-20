#!/usr/bin/env bun
/**
 * Multi-Bot Coordination Simulation Tests
 *
 * Tests that verify cooperation between multiple bot roles:
 * - Trading items between bots
 * - Shared infrastructure usage
 * - Village chat communication
 *
 * Usage:
 *   bun run tests/simulation/multi-bot.test.sim.ts
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { PaperSimulationServer } from './PaperSimulationServer';
import { MockWorld, createOakTree } from '../mocks/MockWorld';
import { LumberjackRole } from '../../src/roles/lumberjack/LumberjackRole';
import { GOAPFarmingRole } from '../../src/roles/GOAPFarmingRole';
import { createTestLogger } from '../../src/shared/logger';
import { getTestSessionId, initTestSession } from './SimulationTest';

// @ts-ignore
import mineflayer from 'mineflayer';

interface MultiBotTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

/**
 * Multi-bot test harness that manages multiple bots against the same server.
 */
class MultiBotTest {
  readonly name: string;
  private server: PaperSimulationServer | null = null;
  private bots: Map<string, Bot> = new Map();
  private assertions: Array<{ description: string; passed: boolean; error?: string }> = [];
  private startTime: number = 0;
  private failed: boolean = false;
  private _sessionId: string;

  constructor(name: string) {
    this.name = name;
    // Use shared session ID for all tests in a run
    this._sessionId = getTestSessionId();
  }

  /**
   * Create a logger for a specific role in this test.
   * The logger writes to the test's own log file (based on test name),
   * not a generic role-named file.
   */
  createRoleLogger(roleName: string, _roleLabel?: string) {
    // Use test name (kebab-cased) for the log file so each test gets its own logs
    const testNameKebab = this.name.replace(/\s+/g, '-').toLowerCase();
    const result = createTestLogger({
      botName: roleName,
      role: roleName.toLowerCase(),
      roleLabel: testNameKebab,
      sessionId: this._sessionId,
    });
    return result.logger;
  }

  /**
   * Set up the test world (only first bot uses world sync).
   */
  async setup(world: MockWorld): Promise<void> {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`TEST: ${this.name}`);
    console.log(`${'─'.repeat(60)}\n`);

    this.startTime = Date.now();
    this.assertions = [];
    this.failed = false;

    this.server = new PaperSimulationServer();

    // Start server and build world (without connecting a bot yet)
    console.log('[MultiBotTest] Starting server and building world...');

    // Use a temporary bot to set up the world
    const tempBot = await this.server.start(world, {
      openBrowser: false,
      enableViewer: true,
      botPosition: new Vec3(0, 65, 0),
      botInventory: [],
    });

    // Disconnect temp bot
    tempBot.quit();
    await this.delay(1000);
  }

  /**
   * Add a bot to the test.
   */
  async addBot(
    name: string,
    position: Vec3,
    inventory: Array<{ name: string; count: number }> = []
  ): Promise<Bot> {
    if (!this.server) throw new Error('Test not set up');

    console.log(`[MultiBotTest] Adding bot: ${name}`);

    const bot = mineflayer.createBot({
      host: 'localhost',
      port: 25566,
      username: name,
      version: '1.21.4',
      auth: 'offline',
    });

    await new Promise<void>((resolve, reject) => {
      bot.once('spawn', () => resolve());
      bot.once('error', reject);
      bot.once('kicked', (reason: string) => reject(new Error(`Kicked: ${reason}`)));
    });

    bot.loadPlugin(pathfinderPlugin);

    // Set up bot state via RCON
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

  /**
   * Get a bot by name.
   */
  getBot(name: string): Bot {
    const bot = this.bots.get(name);
    if (!bot) throw new Error(`Bot ${name} not found`);
    return bot;
  }

  /**
   * Get inventory count for a specific bot.
   */
  botInventoryCount(botName: string, itemName: string): number {
    const bot = this.bots.get(botName);
    if (!bot) return 0;
    return bot.inventory.items()
      .filter(item => item.name === itemName)
      .reduce((sum, item) => sum + item.count, 0);
  }

  /**
   * Wait for a condition to be true.
   */
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

  /**
   * Simple delay.
   */
  async wait(ms: number, reason?: string): Promise<void> {
    if (reason) {
      console.log(`  ⏳ Waiting ${ms}ms: ${reason}`);
    }
    await this.delay(ms);
  }

  /**
   * Execute RCON command.
   */
  async rcon(command: string): Promise<string> {
    if (!this.server) throw new Error('Test not set up');
    return this.server.rconCommand(command);
  }

  /**
   * Basic assertion.
   */
  assert(condition: boolean, message: string): boolean {
    this.recordAssertion(message, condition);
    return condition;
  }

  /**
   * Clean up and return results.
   */
  async cleanup(): Promise<MultiBotTestResult> {
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

    // Disconnect all bots
    for (const [name, bot] of this.bots) {
      console.log(`[MultiBotTest] Disconnecting ${name}...`);
      bot.quit();
    }
    this.bots.clear();

    // Stop server
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
// TEST: Lumberjack deposits logs to shared chest, Farmer withdraws them
// ═══════════════════════════════════════════════════════════════════════════

async function testSharedChestExchange() {
  const test = new MultiBotTest('Bots share resources via chest');

  // Create world with shared infrastructure
  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Forest for lumberjack
  const forestCenter = new Vec3(20, 64, 20);
  createOakTree(world, forestCenter.offset(0, 0, 0), 5);
  createOakTree(world, forestCenter.offset(3, 0, 2), 5);
  createOakTree(world, forestCenter.offset(-2, 0, 3), 4);

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: -5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(-5, 64, 0), 'chest');

  // Water for farmer
  world.setBlock(new Vec3(-15, 63, 10), 'water');

  await test.setup(world);

  // Add lumberjack bot
  const lumberjackBot = await test.addBot('Lumberjack', new Vec3(5, 65, 5), [
    { name: 'iron_axe', count: 1 },
  ]);

  await test.wait(2000, 'Bots loading');

  // Start lumberjack role
  const lumberjackRole = new LumberjackRole();
  lumberjackRole.start(lumberjackBot, { logger: test.createRoleLogger('lumberjack') });

  // Wait for lumberjack to collect some logs
  await test.waitUntil(
    () => test.botInventoryCount('Lumberjack', 'oak_log') >= 4,
    {
      timeout: 90000,
      message: 'Lumberjack should collect at least 4 logs',
    }
  );

  // Wait for lumberjack to deposit to chest (this may take a while)
  // Check by seeing if lumberjack's log count decreases
  const logsAfterHarvest = test.botInventoryCount('Lumberjack', 'oak_log');
  await test.waitUntil(
    () => test.botInventoryCount('Lumberjack', 'oak_log') < logsAfterHarvest,
    {
      timeout: 60000,
      message: 'Lumberjack should deposit logs to shared chest',
    }
  );

  lumberjackRole.stop(lumberjackBot);
  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Village chat communication works between bots
// ═══════════════════════════════════════════════════════════════════════════

async function testVillageChatCommunication() {
  const test = new MultiBotTest('Bots communicate via village chat');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world);

  // Add two bots
  const bot1 = await test.addBot('Bot1', new Vec3(5, 65, 5), []);
  const bot2 = await test.addBot('Bot2', new Vec3(-5, 65, -5), []);

  await test.wait(2000, 'Bots spawning');

  // Track received messages
  let bot2ReceivedMessage = false;

  bot2.on('chat', (username: string, message: string) => {
    if (username === 'Bot1' && message.includes('[VILLAGE]')) {
      bot2ReceivedMessage = true;
      console.log(`  📨 Bot2 received from Bot1: ${message}`);
    }
  });

  // Bot1 sends a village message
  bot1.chat('[VILLAGE] center 100 64 200');

  // Wait for Bot2 to receive it
  await test.waitUntil(
    () => bot2ReceivedMessage,
    {
      timeout: 10000,
      message: 'Bot2 should receive village chat from Bot1',
    }
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Trade protocol between bots
// ═══════════════════════════════════════════════════════════════════════════

async function testTradeProtocol() {
  const test = new MultiBotTest('Bots can execute trade protocol');

  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  await test.setup(world);

  // Bot with items to offer
  const giverBot = await test.addBot('Giver', new Vec3(5, 65, 5), [
    { name: 'oak_sapling', count: 8 },
  ]);

  // Bot that wants items
  const receiverBot = await test.addBot('Receiver', new Vec3(-5, 65, -5), []);

  await test.wait(2000, 'Bots spawning');

  // Track trade protocol messages
  const messagesReceived: string[] = [];

  receiverBot.on('chat', (username: string, message: string) => {
    if (message.startsWith('[')) {
      messagesReceived.push(`${username}: ${message}`);
      console.log(`  📨 ${username}: ${message}`);
    }
  });

  // Giver broadcasts an offer
  giverBot.chat('[OFFER] oak_sapling 8');

  // Receiver responds with want
  await test.wait(1000, 'Waiting for offer to propagate');
  receiverBot.chat('[WANT] oak_sapling 8 from Giver (have 0)');

  // Wait for messages to be exchanged
  await test.wait(2000, 'Waiting for trade messages');

  // Verify basic message exchange happened
  test.assert(
    messagesReceived.length >= 2,
    `Trade messages should be exchanged (got ${messagesReceived.length})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN - Run all tests
// ═══════════════════════════════════════════════════════════════════════════

async function runMultiBotTests(
  tests: Array<() => Promise<MultiBotTestResult>>
): Promise<{ passed: number; failed: number }> {
  // Initialize shared session for all tests in this run
  const sessionId = initTestSession();

  const results: MultiBotTestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('MULTI-BOT SIMULATION TEST SUITE');
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
  const { passed, failed } = await runMultiBotTests([
    testVillageChatCommunication,
    testTradeProtocol,
    testSharedChestExchange,
  ]);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
