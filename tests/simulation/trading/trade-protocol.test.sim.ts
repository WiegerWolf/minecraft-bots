#!/usr/bin/env bun
/**
 * Trading Protocol Simulation Tests
 *
 * SPECIFICATION: Bot Trading via Village Chat Protocol
 *
 * Tests the complete trading protocol between bots:
 * - [OFFER] broadcast for unwanted items
 * - [WANT] response with current count
 * - [TRADE_ACCEPT] selecting neediest responder
 * - [TRADE_AT] meeting point announcement
 * - [TRADE_READY] arrival confirmation
 * - [TRADE_DROPPED] item drop notification
 * - [TRADE_DONE] completion confirmation
 *
 * Item categorization tested:
 * - Farmer helps gather: dirt, cobblestone, gravel, sand (for landscaper)
 * - Lumberjack helps gather: seeds, wheat, carrots, potatoes (for farmer)
 * - Landscaper helps gather: saplings, logs (for lumberjack)
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
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
 * Multi-bot test harness for trading tests.
 */
class TradingTest {
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

    console.log('[TradingTest] Starting server and building world...');

    // Use a temporary bot to set up the world
    const tempBot = await this.server.start(world, {
      openBrowser: false,
      enableViewer: false,
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

    console.log(`[TradingTest] Adding bot: ${name} at ${position}`);

    const bot = mineflayer.createBot({
      host: 'localhost',
      port: 25566,
      username: name,
      version: '1.21.6',
      auth: 'offline',
      checkTimeoutInterval: 120000, // Increase keepalive timeout to 120s for multi-bot tests
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

  distanceBetweenBots(bot1Name: string, bot2Name: string): number {
    const pos1 = this.getBotPosition(bot1Name);
    const pos2 = this.getBotPosition(bot2Name);
    if (!pos1 || !pos2) return Infinity;
    return pos1.distanceTo(pos2);
  }

  /**
   * Check if a specific chat message was sent.
   */
  hasChatMessage(pattern: string | RegExp): boolean {
    return this.chatLog.some(log => {
      if (typeof pattern === 'string') {
        return log.message.includes(pattern);
      }
      return pattern.test(log.message);
    });
  }

  /**
   * Get all chat messages matching a pattern.
   */
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
      console.log(`[TradingTest] Disconnecting ${name}...`);
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
// TEST: Lumberjack offers seeds to farmer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that lumberjack broadcasts seeds (helpful item for farmer)
 * and farmer responds and receives them.
 *
 * Item flow: Lumberjack has wheat_seeds -> offers to farmer -> farmer receives
 */
async function testLumberjackOffersSeedsToFarmer() {
  const test = new TradingTest('Lumberjack offers seeds to farmer');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village sign at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Chest and crafting table for infrastructure
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Add a forest VERY CLOSE so lumberjack detects reachable trees immediately
  // When reachableTreeCount > 0, PatrolForest drops to utility 5
  // This allows BroadcastTradeOffer (utility ~38) to become the active goal
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -8\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(-8, 64, 0), 5);
  createOakTree(world, new Vec3(-12, 64, 3), 5);
  createOakTree(world, new Vec3(-10, 64, -4), 4);

  // Add farm sign but NO water - farmer has "established" farm but can't do work
  // This keeps the farmer idle and ready to respond to trade offers quickly
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  await test.setup(world);

  // Lumberjack with seeds (helpful item for farmer)
  // NO logs - prevents CraftInfrastructure from having utility (needs planks/logs)
  // Give lots of seeds to maximize BroadcastTradeOffer utility (30 + 20 = 50)
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 32 },   // Lots of seeds to trade (max utility 50)
  ]);

  // Farmer with NO seeds - will want them and respond to offers quickly
  // Give sign materials so WriteKnowledgeSign can complete
  // No farming materials means farmer will be idle and responsive to trades
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 0), [
    { name: 'iron_hoe', count: 1 },
    { name: 'oak_sign', count: 8 },       // Can write signs if needed
    { name: 'wheat_seeds', count: 2 },    // Small amount so farmer wants more
  ]);

  await test.wait(8000, 'Bots loading, reading signs, and settling');

  // Verify initial state
  test.assertEqual(
    test.getBotInventoryCount('Test_Lmbr', 'wheat_seeds'),
    32,
    'Lumberjack starts with 32 wheat_seeds'
  );
  const farmerInitialSeeds = test.getBotInventoryCount('Test_Farmer', 'wheat_seeds');
  test.assert(farmerInitialSeeds <= 2, `Farmer starts with few seeds (has ${farmerInitialSeeds})`);

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for trade offer to be broadcast
  // Bots need time to study signs, establish knowledge, and get to trading
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]'),
    {
      timeout: 180000,  // 3 minutes - bots need time to settle
      message: 'Lumberjack should broadcast [OFFER] for seeds',
    }
  );

  // Wait for want response
  await test.waitUntil(
    () => test.hasChatMessage('[WANT]'),
    {
      timeout: 30000,
      message: 'Farmer should respond with [WANT]',
    }
  );

  // Wait for trade acceptance (must be longer than OFFER_COLLECTION_WINDOW of 15s)
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_ACCEPT]'),
    {
      timeout: 30000,
      message: 'Lumberjack should send [TRADE_ACCEPT]',
    }
  );

  // Wait for trade completion
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 120000,  // 2 minutes for trade to complete
      message: 'Trade should complete with [TRADE_DONE]',
    }
  );

  // Verify final inventory state
  await test.wait(2000, 'Inventory settling');

  const farmerSeeds = test.getBotInventoryCount('Test_Farmer', 'wheat_seeds');
  test.assertGreater(farmerSeeds, 2, `Farmer should have received seeds (started with 2, now has ${farmerSeeds})`);

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer offers dirt to landscaper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that farmer broadcasts dirt (helpful item for landscaper)
 * and landscaper responds and receives them.
 */
async function testFarmerOffersDirtToLandscaper() {
  const test = new TradingTest('Farmer offers dirt to landscaper');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Add water and farm sign so farmer has an established farm
  world.setBlock(new Vec3(10, 63, 10), 'water');
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 63\nZ: 10' });

  // Add work area sign for landscaper
  world.setBlock(new Vec3(-6, 64, 2), 'oak_sign', { signText: '[WORK]\nX: 20\nY: 64\nZ: 20' });

  await test.setup(world);

  // Farmer with dirt (helpful item for landscaper)
  // Give sign materials so WriteKnowledgeSign can complete
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(0, 65, 0), [
    { name: 'iron_hoe', count: 1 },
    { name: 'wheat_seeds', count: 16 },
    { name: 'dirt', count: 10 }, // Farmer will offer this to landscaper
    { name: 'oak_sign', count: 8 }, // For writing knowledge signs
  ]);

  // Landscaper with no dirt (will want it)
  const landscaperBot = await test.addBot('Test_Land', new Vec3(3, 65, 0), [
    { name: 'iron_shovel', count: 1 },
    { name: 'iron_pickaxe', count: 1 },
  ]);

  await test.wait(8000, 'Bots loading, reading signs, and settling');

  // Verify initial state
  test.assertEqual(
    test.getBotInventoryCount('Test_Farmer', 'dirt'),
    10,
    'Farmer starts with 10 dirt'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_Land', 'dirt'),
    0,
    'Landscaper starts with 0 dirt'
  );

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const landscaperRole = new GOAPLandscaperRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Land', landscaperRole, 'landscaper');

  // Wait for trade offer to be broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]') && test.hasChatMessage('dirt'),
    {
      timeout: 60000,
      message: 'Farmer should broadcast [OFFER] for dirt',
    }
  );

  // Wait for trade completion
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 90000,
      message: 'Trade should complete with [TRADE_DONE]',
    }
  );

  // Verify landscaper received dirt
  await test.wait(2000, 'Inventory settling');

  const landscaperDirt = test.getBotInventoryCount('Test_Land', 'dirt');
  test.assertGreater(landscaperDirt, 0, `Landscaper should have received dirt (has ${landscaperDirt})`);

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Trade meeting point and proximity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that bots meet at the designated trade location.
 */
async function testTradeMeetingPoint() {
  const test = new TradingTest('Bots meet at trade location');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure - center is at origin
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(10, 64, 0), 'chest');
  world.setBlock(new Vec3(10, 64, 2), 'crafting_table');

  // Add forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -20\nY: 64\nZ: -20' });
  createOakTree(world, new Vec3(-20, 64, -20), 5);
  createOakTree(world, new Vec3(-23, 64, -17), 5);

  // Add farm for farmer
  world.setBlock(new Vec3(10, 63, 10), 'water');
  world.setBlock(new Vec3(5, 64, 5), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  await test.setup(world);

  // Start bots at different positions
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(-15, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 },
  ]);

  const farmerBot = await test.addBot('Test_Farmer', new Vec3(15, 65, 0), [
    { name: 'iron_hoe', count: 1 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Record initial distance
  const initialDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Farmer');
  console.log(`  📏 Initial distance between bots: ${initialDistance.toFixed(1)} blocks`);
  test.assert(initialDistance > 25, 'Bots should start far apart');

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const farmerRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Farmer', farmerRole, 'farmer');

  // Wait for trade meeting point announcement
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_AT]'),
    {
      timeout: 60000,
      message: 'Should receive [TRADE_AT] meeting point',
    }
  );

  // Wait for both bots to be ready
  await test.waitUntil(
    () => {
      const readyMessages = test.getChatMessages('[TRADE_READY]');
      return readyMessages.length >= 2;
    },
    {
      timeout: 30000,
      message: 'Both bots should send [TRADE_READY]',
    }
  );

  // Verify bots are close together
  const meetingDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Farmer');
  console.log(`  📏 Distance at meeting point: ${meetingDistance.toFixed(1)} blocks`);
  test.assert(meetingDistance < 6, `Bots should be close at meeting point (${meetingDistance.toFixed(1)} blocks)`);

  // Wait for trade completion
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
// TEST: Neediest selection (lower count wins)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that when multiple bots want an item, the one with fewer
 * of that item is selected (neediest wins).
 */
async function testNeediestSelection() {
  const test = new TradingTest('Neediest bot is selected for trade');

  const world = new MockWorld();
  world.fill(new Vec3(-40, 63, -40), new Vec3(40, 63, 40), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(10, 64, 0), 'chest');

  // Add forest for lumberjack
  world.setBlock(new Vec3(-5, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: -25\nY: 64\nZ: -25' });
  createOakTree(world, new Vec3(-25, 64, -25), 5);
  createOakTree(world, new Vec3(-28, 64, -22), 5);

  // Add farm areas for farmers
  world.setBlock(new Vec3(15, 63, 15), 'water');
  world.setBlock(new Vec3(12, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 15\nY: 64\nZ: 15' });

  await test.setup(world);

  // Lumberjack with seeds to offer
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'wheat_seeds', count: 8 },
  ]);

  // Farmer A with 0 seeds (should be selected - neediest)
  const farmerABot = await test.addBot('Test_FarmerA', new Vec3(-10, 65, 0), [
    { name: 'iron_hoe', count: 1 },
  ]);

  // Farmer B with 5 seeds (should NOT be selected)
  const farmerBBot = await test.addBot('Test_FarmerB', new Vec3(10, 65, 0), [
    { name: 'iron_hoe', count: 1 },
    { name: 'wheat_seeds', count: 5 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Verify initial seeds
  test.assertEqual(
    test.getBotInventoryCount('Test_FarmerA', 'wheat_seeds'),
    0,
    'Farmer A starts with 0 seeds'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_FarmerB', 'wheat_seeds'),
    5,
    'Farmer B starts with 5 seeds'
  );

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const farmerARole = new GOAPFarmingRole();
  const farmerBRole = new GOAPFarmingRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_FarmerA', farmerARole, 'farmer');
  test.startRole('Test_FarmerB', farmerBRole, 'farmer');

  // Wait for offer
  await test.waitUntil(
    () => test.hasChatMessage('[OFFER]'),
    {
      timeout: 60000,
      message: 'Lumberjack should broadcast offer',
    }
  );

  // Wait for both WANT responses
  await test.waitUntil(
    () => {
      const wantMessages = test.getChatMessages('[WANT]');
      return wantMessages.length >= 2;
    },
    {
      timeout: 15000,
      message: 'Both farmers should respond with [WANT]',
    }
  );

  // Wait for acceptance - should be Farmer A (has 0)
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_ACCEPT] Test_FarmerA'),
    {
      timeout: 15000,
      message: 'Farmer A (neediest) should be selected',
    }
  );

  // Wait for trade completion
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 60000,
      message: 'Trade should complete',
    }
  );

  // Verify Farmer A got the seeds
  await test.wait(2000, 'Inventory settling');

  const farmerASeeds = test.getBotInventoryCount('Test_FarmerA', 'wheat_seeds');
  const farmerBSeeds = test.getBotInventoryCount('Test_FarmerB', 'wheat_seeds');

  test.assertGreater(farmerASeeds, 0, `Farmer A should have received seeds (has ${farmerASeeds})`);
  test.assertEqual(farmerBSeeds, 5, `Farmer B should still have only 5 seeds (has ${farmerBSeeds})`);

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Trade item verification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that the correct item and quantity are transferred.
 */
async function testTradeItemVerification() {
  const test = new TradingTest('Correct item and quantity are traded');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');

  // Add work area for landscaper
  world.setBlock(new Vec3(-5, 64, 0), 'oak_sign', { signText: '[WORK]\nX: 20\nY: 64\nZ: 20' });

  // Add forest for lumberjack
  world.setBlock(new Vec3(5, 64, 5), 'oak_sign', { signText: '[FOREST]\nX: -20\nY: 64\nZ: -20' });
  createOakTree(world, new Vec3(-20, 64, -20), 5);
  createOakTree(world, new Vec3(-23, 64, -17), 5);

  await test.setup(world);

  // Landscaper with saplings (helpful for lumberjack)
  const landscaperBot = await test.addBot('Test_Land', new Vec3(0, 65, 0), [
    { name: 'iron_shovel', count: 1 },
    { name: 'oak_sapling', count: 6 },
  ]);

  // Lumberjack who wants saplings
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(5, 65, 0), [
    { name: 'iron_axe', count: 1 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Record initial counts
  const landscaperSaplingsBefore = test.getBotInventoryCount('Test_Land', 'oak_sapling');
  const lumberjackSaplingsBefore = test.getBotInventoryCount('Test_Lmbr', 'oak_sapling');

  test.assertEqual(landscaperSaplingsBefore, 6, 'Landscaper starts with 6 saplings');
  test.assertEqual(lumberjackSaplingsBefore, 0, 'Lumberjack starts with 0 saplings');

  // Start roles
  const landscaperRole = new GOAPLandscaperRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Land', landscaperRole, 'landscaper');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for trade completion
  await test.waitUntil(
    () => test.hasChatMessage('[TRADE_DONE]'),
    {
      timeout: 120000,
      message: 'Trade should complete',
    }
  );

  await test.wait(2000, 'Inventory settling');

  // Verify item transfer
  const landscaperSaplingsAfter = test.getBotInventoryCount('Test_Land', 'oak_sapling');
  const lumberjackSaplingsAfter = test.getBotInventoryCount('Test_Lmbr', 'oak_sapling');

  console.log(`  📦 Landscaper saplings: ${landscaperSaplingsBefore} -> ${landscaperSaplingsAfter}`);
  console.log(`  📦 Lumberjack saplings: ${lumberjackSaplingsBefore} -> ${lumberjackSaplingsAfter}`);

  // Landscaper should have fewer saplings
  test.assert(
    landscaperSaplingsAfter < landscaperSaplingsBefore,
    `Landscaper should have given away saplings (${landscaperSaplingsAfter} < ${landscaperSaplingsBefore})`
  );

  // Lumberjack should have received saplings
  test.assertGreater(
    lumberjackSaplingsAfter,
    lumberjackSaplingsBefore,
    `Lumberjack should have received saplings (${lumberjackSaplingsAfter} > ${lumberjackSaplingsBefore})`
  );

  // Total should be conserved (no items lost)
  const totalBefore = landscaperSaplingsBefore + lumberjackSaplingsBefore;
  const totalAfter = landscaperSaplingsAfter + lumberjackSaplingsAfter;
  test.assertEqual(
    totalAfter,
    totalBefore,
    `Total saplings should be conserved (${totalAfter} = ${totalBefore})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'lumberjack-seeds': testLumberjackOffersSeedsToFarmer,
  'farmer-dirt': testFarmerOffersDirtToLandscaper,
  'meeting-point': testTradeMeetingPoint,
  'neediest': testNeediestSelection,
  'verification': testTradeItemVerification,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('TRADING PROTOCOL SIMULATION TESTS');
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
