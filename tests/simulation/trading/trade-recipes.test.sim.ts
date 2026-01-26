#!/usr/bin/env bun
/**
 * Recipe-Based Trading Simulation Tests
 *
 * SPECIFICATION: Intent-Based Need System with Recipe Resolution
 *
 * Tests the need-based trading system where bots express what they're trying
 * to accomplish (e.g., [NEED] hoe) rather than specific materials, and
 * responders offer what they have - even if it requires crafting.
 *
 * Recipe resolution tested:
 * - Farmer needs hoe → Lumberjack offers planks+sticks (1 crafting step)
 * - Farmer needs hoe → Lumberjack offers logs (2 crafting steps)
 * - Best offer wins based on crafting steps (0 > 1 > 2)
 * - Material categories can satisfy tool needs
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
 * Multi-bot test harness for recipe-based trading tests.
 */
class RecipeTradingTest {
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

    console.log('[RecipeTradingTest] Starting server and building world...');

    // Use a temporary bot to set up the world
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

    console.log(`[RecipeTradingTest] Adding bot: ${name} at ${position}`);

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

    // Listen for chat messages from this bot
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

  getBotInventoryItems(botName: string): Array<{ name: string; count: number }> {
    const bot = this.bots.get(botName);
    if (!bot) return [];
    return bot.inventory.items().map(i => ({ name: i.name, count: i.count }));
  }

  hasChatMessage(pattern: string | RegExp): boolean {
    return this.chatLog.some(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    });
  }

  getChatMessages(pattern: string | RegExp): Array<{ from: string; message: string }> {
    return this.chatLog.filter(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    });
  }

  countChatMessages(pattern: string | RegExp): number {
    return this.getChatMessages(pattern).length;
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

  assertGreater(actual: number, expected: number, message: string): boolean {
    const passed = actual > expected;
    this.recordAssertion(message, passed, passed ? undefined : `Expected > ${expected}, Actual: ${actual}`);
    return passed;
  }

  assertLess(actual: number, expected: number, message: string): boolean {
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
      console.log(`[RecipeTradingTest] Disconnecting ${name}...`);
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
// TEST: Farmer needs hoe, lumberjack offers planks + sticks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that when a farmer broadcasts [NEED] hoe and the lumberjack has
 * planks and sticks (not a hoe itself), the lumberjack recognizes these
 * materials can craft a hoe and offers them.
 *
 * Recipe chain: planks + sticks → wooden_hoe (1 crafting step)
 */
async function testFarmerNeedsHoeLumberjackOffersMaterials() {
  const test = new RecipeTradingTest('Farmer needs hoe - Lumberjack offers planks+sticks');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure signs
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Farm sign but NO water - farmer has "established" farm but can't do work
  // This triggers needsTools = true (needs hoe to farm)
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  // Forest for lumberjack so they have a valid work area
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-15, 64, 0), 5);
  createOakTree(world, new Vec3(-18, 64, 3), 5);

  await test.setup(world);

  // Lumberjack with planks and sticks (materials for hoe, NOT a hoe itself)
  // wooden_hoe requires: 2 planks + 2 sticks
  // NOTE: Give extra planks because lumberjack will use 4 to craft a crafting table
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_planks', count: 16 },  // Extra planks (4 for crafting table, need 4 minimum, 2 for trade)
    { name: 'stick', count: 8 },        // Enough for multiple hoes
  ]);

  // Farmer with NO hoe and NO materials - will broadcast [NEED] hoe
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 0), [
    { name: 'wheat_seeds', count: 8 },  // Has seeds, just needs hoe to farm
  ]);

  await test.wait(5000, 'Bots loading and reading signs');

  // Verify initial state
  test.assertEqual(
    test.getBotInventoryCount('Test_Farmer', 'wooden_hoe'),
    0,
    'Farmer starts with no hoe'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_Lmbr', 'oak_planks'),
    16,
    'Lumberjack starts with 16 planks'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_Lmbr', 'stick'),
    8,
    'Lumberjack starts with 8 sticks'
  );

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for [NEED] broadcast from farmer
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 120000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Wait for [CAN_PROVIDE] response from lumberjack
  // The message should indicate materials (planks, sticks)
  await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    {
      timeout: 60000,
      message: 'Lumberjack should respond with [CAN_PROVIDE] for materials',
    }
  );

  // Verify the offer contains planks or sticks (not a hoe)
  const canProvideMessages = test.getChatMessages('[CAN_PROVIDE]');
  const hasMaterialsOffer = canProvideMessages.some(
    m => m.message.includes('planks') || m.message.includes('stick')
  );
  test.assert(
    hasMaterialsOffer,
    'CAN_PROVIDE offer should include materials (planks/sticks)'
  );

  // Wait for acceptance
  await test.waitUntil(
    () => test.hasChatMessage('[ACCEPT_PROVIDER]'),
    {
      timeout: 45000,
      message: 'Farmer should accept provider',
    }
  );

  // Wait for delivery (could be via chest or trade)
  await test.waitUntil(
    () => test.hasChatMessage('[PROVIDE_AT]'),
    {
      timeout: 30000,
      message: 'Provider should announce delivery location',
    }
  );

  // Wait for materials to be delivered
  // The farmer should eventually get planks/sticks to craft the hoe
  await test.wait(30000, 'Waiting for material delivery');

  // Verify materials transferred
  const lumberjackPlanks = test.getBotInventoryCount('Test_Lmbr', 'oak_planks');
  const lumberjackSticks = test.getBotInventoryCount('Test_Lmbr', 'stick');

  // Lumberjack should have given away some materials
  test.assert(
    lumberjackPlanks < 8 || lumberjackSticks < 8,
    `Lumberjack should have given away materials (planks: ${lumberjackPlanks}, sticks: ${lumberjackSticks})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer needs hoe, lumberjack offers logs (2 crafting steps)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that when a farmer needs a hoe and the lumberjack only has logs,
 * the system recognizes logs can be crafted into planks → sticks → hoe
 * (2 crafting steps).
 *
 * Recipe chain: logs → planks → wooden_hoe (2 crafting steps)
 */
async function testFarmerNeedsHoeLumberjackOffersLogs() {
  const test = new RecipeTradingTest('Farmer needs hoe - Lumberjack offers logs (2 steps)');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Farm sign
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  // Forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-15, 64, 0), 5);
  createOakTree(world, new Vec3(-18, 64, 3), 5);

  await test.setup(world);

  // Lumberjack with ONLY logs (no planks, no sticks)
  // This requires 2 crafting steps: logs → planks, planks → sticks + planks → hoe
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_log', count: 16 },  // Only raw logs
  ]);

  // Farmer needs hoe
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 0), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(5000, 'Bots loading and reading signs');

  // Verify initial state
  test.assertEqual(
    test.getBotInventoryCount('Test_Lmbr', 'oak_log'),
    16,
    'Lumberjack starts with 16 logs'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_Lmbr', 'oak_planks'),
    0,
    'Lumberjack starts with no planks'
  );

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for [NEED] broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 120000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Wait for [CAN_PROVIDE] response - should offer logs since that's all we have
  await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    {
      timeout: 60000,
      message: 'Lumberjack should respond with [CAN_PROVIDE] for logs',
    }
  );

  // Verify the offer contains logs
  const canProvideMessages = test.getChatMessages('[CAN_PROVIDE]');
  const hasLogsOffer = canProvideMessages.some(
    m => m.message.includes('log')
  );
  test.assert(
    hasLogsOffer,
    'CAN_PROVIDE offer should include logs'
  );

  // Wait for acceptance and delivery
  await test.waitUntil(
    () => test.hasChatMessage('[ACCEPT_PROVIDER]'),
    {
      timeout: 45000,
      message: 'Farmer should accept provider',
    }
  );

  await test.waitUntil(
    () => test.hasChatMessage('[PROVIDE_AT]'),
    {
      timeout: 30000,
      message: 'Provider should announce delivery location',
    }
  );

  // Wait for delivery
  await test.wait(30000, 'Waiting for log delivery');

  // Verify logs transferred
  const lumberjackLogs = test.getBotInventoryCount('Test_Lmbr', 'oak_log');
  test.assert(
    lumberjackLogs < 16,
    `Lumberjack should have given away logs (now has ${lumberjackLogs})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Best offer wins (hoe > materials > logs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that when multiple bots offer different things for the same need,
 * the best offer (fewest crafting steps) wins.
 *
 * Scenario:
 * - Lumberjack A has a wooden_hoe (0 crafting steps)
 * - Lumberjack B has planks+sticks (1 crafting step)
 *
 * Expected: Farmer accepts Lumberjack A's offer (the hoe)
 */
async function testBestOfferWinsBasedOnCraftingSteps() {
  const test = new RecipeTradingTest('Best offer wins (0 steps > 1 step)');

  const world = new MockWorld();
  world.fill(new Vec3(-40, 63, -40), new Vec3(40, 63, 40), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Farm sign
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  // Forest for lumberjacks
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -20\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-20, 64, 0), 5);
  createOakTree(world, new Vec3(-23, 64, 3), 5);
  createOakTree(world, new Vec3(-26, 64, -2), 5);

  await test.setup(world);

  // Lumberjack A with an actual hoe (0 crafting steps - best offer)
  const lumberjackABot = await test.addBot('Test_LmbrA', new Vec3(-5, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wooden_hoe', count: 1 },  // Direct item!
  ]);

  // Lumberjack B with materials only (1 crafting step)
  // NOTE: Give extra planks because lumberjack may use some for crafting table
  const lumberjackBBot = await test.addBot('Test_LmbrB', new Vec3(5, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_planks', count: 16 },
    { name: 'stick', count: 8 },
  ]);

  // Farmer needs hoe
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(0, 65, 3), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(5000, 'Bots loading and reading signs');

  // Verify initial state
  test.assertEqual(
    test.getBotInventoryCount('Test_LmbrA', 'wooden_hoe'),
    1,
    'Lumberjack A starts with 1 hoe'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_LmbrB', 'oak_planks'),
    16,
    'Lumberjack B starts with 16 planks'
  );

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackARole = new GOAPLumberjackRole();
  const lumberjackBRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_LmbrA', lumberjackARole, 'lumberjack');
  test.startRole('Test_LmbrB', lumberjackBRole, 'lumberjack');

  // Wait for [NEED] broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 120000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Wait for multiple [CAN_PROVIDE] responses
  await test.waitUntil(
    () => test.countChatMessages('[CAN_PROVIDE]') >= 2,
    {
      timeout: 60000,
      message: 'Both lumberjacks should respond with [CAN_PROVIDE]',
    }
  );

  // Wait for acceptance - should be Lumberjack A (has the hoe)
  await test.waitUntil(
    () => test.hasChatMessage('[ACCEPT_PROVIDER]') && test.hasChatMessage('Test_LmbrA'),
    {
      timeout: 45000,
      message: 'Farmer should accept Lumberjack A (has hoe, 0 crafting steps)',
    }
  );

  // Verify the hoe provider was selected, not the materials provider
  const acceptMessages = test.getChatMessages('[ACCEPT_PROVIDER]');
  const acceptedLmbrA = acceptMessages.some(m => m.message.includes('Test_LmbrA'));
  test.assert(
    acceptedLmbrA,
    'Lumberjack A (with hoe) should be accepted, not Lumberjack B (with materials)'
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Material category helps satisfy tool need
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that the lumberjack's configured canProvideCategories (['log', 'planks', 'stick'])
 * correctly enables responding to tool needs (hoe, axe, etc.) via recipe resolution.
 *
 * This validates the canMaterialsHelpWith() function in RecipeService.
 */
async function testMaterialCategoriesSatisfyToolNeeds() {
  const test = new RecipeTradingTest('Material categories satisfy tool needs');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Farm sign
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  // Forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-15, 64, 0), 5);

  await test.setup(world);

  // Lumberjack with mixed wood materials
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_log', count: 4 },
    { name: 'oak_planks', count: 4 },
    { name: 'stick', count: 4 },
  ]);

  // Farmer needs hoe
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 0), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(5000, 'Bots loading and reading signs');

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for [NEED] broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 120000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Lumberjack should recognize it can help with 'hoe' need
  // because its canProvideCategories include materials used in hoe recipes
  await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    {
      timeout: 60000,
      message: 'Lumberjack should recognize it can help with hoe need via recipe resolution',
    }
  );

  // The offer should include the best materials (planks+sticks = 1 step, not logs = 2 steps)
  const canProvideMessages = test.getChatMessages('[CAN_PROVIDE]');
  console.log(`  📢 CAN_PROVIDE messages: ${canProvideMessages.map(m => m.message).join('; ')}`);

  // Verify the system chose the right materials
  // Should prefer planks+sticks (1 step) over logs (2 steps)
  const hasPlanksOrSticks = canProvideMessages.some(
    m => m.message.includes('planks') || m.message.includes('stick')
  );
  test.assert(
    hasPlanksOrSticks,
    'Offer should include planks or sticks (1 crafting step) not just logs'
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'materials-for-hoe': testFarmerNeedsHoeLumberjackOffersMaterials,
  'logs-for-hoe': testFarmerNeedsHoeLumberjackOffersLogs,
  'best-offer-wins': testBestOfferWinsBasedOnCraftingSteps,
  'category-resolution': testMaterialCategoriesSatisfyToolNeeds,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('RECIPE-BASED TRADING SIMULATION TESTS');
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
