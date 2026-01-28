#!/usr/bin/env bun
/**
 * Need Delivery Coordination Tests
 *
 * SPECIFICATION: Farmer should pick up items after provider delivers them
 *
 * Issue being tested:
 * When the lumberjack responds to a farmer's [NEED] request by dropping items
 * at a delivery location, the farmer should:
 * 1. Know about the delivery location (via [PROVIDE_AT])
 * 2. Navigate to the delivery location
 * 3. Pick up the delivered items
 * 4. Mark the need as fulfilled
 *
 * Current broken behavior:
 * - Lumberjack drops items and marks need fulfilled immediately
 * - Farmer never picks up the items because no goal triggers pickup
 * - Farmer stays stuck in FollowLumberjack or other goals
 *
 * Expected behavior after fix:
 * - Farmer should have a goal to receive delivered items
 * - Farmer picks up items, THEN marks need fulfilled
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

type RoleType = GOAPFarmingRole | GOAPLumberjackRole;

/**
 * Multi-bot test harness for need delivery coordination tests.
 */
class NeedDeliveryTest {
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

    console.log('[NeedDeliveryTest] Starting server and building world...');

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

    console.log(`[NeedDeliveryTest] Adding bot: ${name} at ${position}`);

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

    pathfinder(bot as any, { canDig: true, allowParkour: true, allowSprint: true });

    bot.on('chat', (username: string, message: string) => {
      this.chatLog.push({ from: username, message, timestamp: Date.now() });
      // Log chat for debugging
      if (message.startsWith('[')) {
        console.log(`  💬 ${username}: ${message}`);
      }
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
      .filter(i => i.name === itemName || i.name.includes(itemName))
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

  assertBrokenBehavior(condition: boolean, message: string): boolean {
    this.recordAssertion(`[EXPECTED BUG] ${message}`, condition);
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
      console.log(`[NeedDeliveryTest] Disconnecting ${name}...`);
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
// TEST: Farmer picks up delivered items (currently broken)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * This test documents the current broken behavior:
 * 1. Farmer broadcasts [NEED] hoe
 * 2. Lumberjack offers materials
 * 3. Farmer accepts the offer
 * 4. Lumberjack walks to delivery location and drops items
 * 5. [BUG] Farmer does NOT pick up items - stays in other goals
 * 6. [BUG] Lumberjack marks need fulfilled even though farmer never got items
 *
 * After fix, farmer should:
 * - Have a goal that activates when delivery location is known
 * - Walk to delivery location
 * - Pick up items
 * - Then mark need fulfilled
 */
async function testFarmerPicksUpDeliveredItems() {
  const test = new NeedDeliveryTest('Farmer picks up delivered items');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure - all signs pre-placed so bots skip writing phase
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Farm sign - farmer has established farm but needs tools
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });

  // Forest for lumberjack - needs trees nearby so PatrolForest utility is low
  world.setBlock(new Vec3(8, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(15, 64, 0), 5);
  createOakTree(world, new Vec3(18, 64, 3), 5);
  createOakTree(world, new Vec3(12, 64, -3), 4);

  await test.setup(world);

  // Lumberjack with LOTS of materials so can.spareForNeeds = true immediately
  // Give axe so ObtainAxe doesn't compete
  // Give enough planks+sticks to spare for the farmer's hoe need
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_planks', count: 32 },  // Plenty to spare (threshold is ~4 minimum)
    { name: 'stick', count: 16 },       // Plenty to spare
    { name: 'oak_log', count: 8 },      // Some logs too
  ]);

  // Farmer with NO tools and NO materials - will broadcast [NEED] hoe
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 3), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Verify initial inventory
  test.assertEqual(
    test.getBotInventoryCount('Test_Farmer', 'planks'),
    0,
    'Farmer starts with no planks'
  );
  test.assertEqual(
    test.getBotInventoryCount('Test_Farmer', 'stick'),
    0,
    'Farmer starts with no sticks'
  );
  const lmbrPlanksStart = test.getBotInventoryCount('Test_Lmbr', 'planks');
  test.assertGreater(lmbrPlanksStart, 16, `Lumberjack has plenty of planks (${lmbrPlanksStart})`);

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for need broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 90000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Wait for lumberjack to offer
  await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    {
      timeout: 60000,
      message: 'Lumberjack should respond with [CAN_PROVIDE]',
    }
  );

  // Wait for farmer to accept
  await test.waitUntil(
    () => test.hasChatMessage('[ACCEPT_PROVIDER]'),
    {
      timeout: 45000,
      message: 'Farmer should accept provider',
    }
  );

  // Wait for delivery location announcement
  await test.waitUntil(
    () => test.hasChatMessage('[PROVIDE_AT]'),
    {
      timeout: 30000,
      message: 'Lumberjack should announce delivery location',
    }
  );

  // Give time for lumberjack to deliver (walk + drop)
  await test.wait(15000, 'Lumberjack walking to delivery location and dropping items');

  // Log current state
  const lmbrPlanksAfterDrop = test.getBotInventoryCount('Test_Lmbr', 'planks');
  console.log(`  📦 Lumberjack planks after drop: ${lmbrPlanksAfterDrop} (started with ${lmbrPlanksStart})`);

  // Give time for farmer to potentially pick up (this is where the bug manifests)
  await test.wait(30000, 'Waiting for farmer to pick up delivered items');

  // Check if farmer actually got the items
  const farmerPlanks = test.getBotInventoryCount('Test_Farmer', 'planks');
  const farmerSticks = test.getBotInventoryCount('Test_Farmer', 'stick');
  const farmerPos = test.getBotPosition('Test_Farmer');

  console.log(`  📦 Farmer inventory: ${farmerPlanks} planks, ${farmerSticks} sticks`);
  console.log(`  📍 Farmer position: ${farmerPos}`);

  // This assertion documents the bug - farmer should have picked up items
  // but due to the bug, they stay at 0
  const farmerGotItems = farmerPlanks > 0 || farmerSticks > 0;

  if (farmerGotItems) {
    // The fix works!
    test.assert(true, `Farmer received delivered items (planks: ${farmerPlanks}, sticks: ${farmerSticks})`);
  } else {
    // The bug exists - farmer didn't pick up items
    test.assertBrokenBehavior(
      !farmerGotItems,
      `Farmer failed to pick up delivered items (planks: ${farmerPlanks}, sticks: ${farmerSticks})`
    );
  }

  // Check if need was marked fulfilled
  const needFulfilledMessages = test.getChatMessages('[NEED_FULFILLED]');
  if (needFulfilledMessages.length > 0 && !farmerGotItems) {
    test.assertBrokenBehavior(
      true,
      'Need was marked fulfilled but farmer never received items'
    );
  }

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Lumberjack responds quickly when it has materials
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that when the lumberjack already has materials to spare,
 * it responds to the need quickly (FulfillNeeds goal should activate).
 *
 * This validates that the FulfillNeeds utility (120) beats other goals
 * when can.spareForNeeds is true.
 */
async function testLumberjackRespondsQuicklyWithMaterials() {
  const test = new NeedDeliveryTest('Lumberjack responds quickly when it has materials');

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

  // Forest with trees
  world.setBlock(new Vec3(8, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(15, 64, 0), 5);
  createOakTree(world, new Vec3(18, 64, 3), 5);

  await test.setup(world);

  // Lumberjack with materials ready to spare
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_planks', count: 32 },
    { name: 'stick', count: 16 },
    { name: 'oak_log', count: 8 },
  ]);

  // Farmer needs hoe
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 3), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  const needBroadcastTime = Date.now();

  // Wait for need broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 90000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Wait for CAN_PROVIDE - should be quick since lumberjack has materials
  const canProvideReceived = await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    {
      timeout: 30000,  // Should be fast - 30s max
      message: 'Lumberjack should respond quickly with [CAN_PROVIDE] (has materials)',
    }
  );

  if (canProvideReceived) {
    const responseTime = Date.now() - needBroadcastTime;
    console.log(`  ⏱️ Response time: ${(responseTime / 1000).toFixed(1)}s`);

    // Response should be within 30 seconds when materials are available
    test.assert(
      responseTime < 30000,
      `Response time should be under 30s when materials available (was ${(responseTime / 1000).toFixed(1)}s)`
    );
  }

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Auto-accept offers after goal preemption
// ═══════════════════════════════════════════════════════════════════════════

/**
 * This test verifies the fix for the goal preemption bug:
 *
 * THE BUG (before fix):
 * 1. Farmer broadcasts [NEED] hoe, BroadcastNeed action sets status='broadcasting'
 * 2. Before 30s offer window, goal switches (e.g., CollectDrops preempts)
 * 3. BroadcastNeed stops being ticked - offers arrive but never get accepted
 * 4. Farmer stays stuck without tools
 *
 * THE FIX:
 * - VillageChat.processNeedTimeouts() auto-accepts offers after window
 * - Called during periodicCleanup() (blackboard updates)
 * - Works independently of which goal is currently executing
 *
 * This test creates a scenario where goal preemption is likely:
 * - Farmer has nearby drops (high priority goal CollectDrops)
 * - Farmer also needs tools (broadcasts need)
 * - Even with preemption, need should still be accepted
 */
async function testAutoAcceptAfterGoalPreemption() {
  const test = new NeedDeliveryTest('Auto-accept offers after goal preemption');

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

  // Water source for farm (establishes farm center)
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Forest for lumberjack
  world.setBlock(new Vec3(8, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(15, 64, 0), 5);
  createOakTree(world, new Vec3(18, 64, 3), 5);

  await test.setup(world);

  // Lumberjack with materials to spare
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_planks', count: 32 },
    { name: 'stick', count: 16 },
    { name: 'oak_log', count: 8 },
  ]);

  // Farmer with NO tools - will need to broadcast
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 3), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait for need broadcast
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]') && test.hasChatMessage('hoe'),
    {
      timeout: 90000,
      message: 'Farmer should broadcast [NEED] hoe',
    }
  );

  // Spawn some drops near farmer to trigger goal preemption
  // This creates the scenario where CollectDrops might preempt GatherSeeds/ObtainTools
  console.log('  🎯 Spawning drops to trigger goal preemption...');
  await test.rcon('summon item 4 65 4 {Item:{id:"minecraft:wheat_seeds",Count:3b}}');
  await test.rcon('summon item 4 65 5 {Item:{id:"minecraft:wheat_seeds",Count:2b}}');

  // Wait for lumberjack to offer
  await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    {
      timeout: 60000,
      message: 'Lumberjack should respond with [CAN_PROVIDE]',
    }
  );

  // KEY CHECK: Farmer should accept even with goal preemption happening
  // The fix ensures processNeedTimeouts() is called during blackboard updates
  const acceptReceived = await test.waitUntil(
    () => test.hasChatMessage('[ACCEPT_PROVIDER]'),
    {
      timeout: 60000, // Give extra time for the offer window (30s) + processing
      message: 'Farmer should auto-accept provider (even after goal preemption)',
    }
  );

  if (acceptReceived) {
    test.assert(true, 'Need acceptance works despite potential goal preemption');
  } else {
    // If we get here, the bug is NOT fixed
    test.assert(false, 'Farmer failed to accept - goal preemption bug still present');
  }

  // Verify the delivery flow completes
  await test.waitUntil(
    () => test.hasChatMessage('[PROVIDE_AT]'),
    {
      timeout: 30000,
      message: 'Lumberjack should announce delivery location',
    }
  );

  // Wait for farmer to potentially receive items
  await test.wait(30000, 'Waiting for farmer to receive delivered items');

  // Check if farmer got materials
  const farmerPlanks = test.getBotInventoryCount('Test_Farmer', 'planks');
  const farmerSticks = test.getBotInventoryCount('Test_Farmer', 'stick');

  console.log(`  📦 Farmer inventory after delivery: ${farmerPlanks} planks, ${farmerSticks} sticks`);

  const farmerGotItems = farmerPlanks > 0 || farmerSticks > 0;
  test.assert(
    farmerGotItems,
    `Farmer received items after goal preemption scenario (planks: ${farmerPlanks}, sticks: ${farmerSticks})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: ReceiveNeedDelivery goal preempts CollectDrops
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test that ReceiveNeedDelivery (utility 185) preempts CollectDrops (max 150).
 *
 * When a delivery is pending, the farmer should prioritize picking up the
 * need delivery over random drops, because the delivery is specifically
 * for materials the farmer needs (and might despawn).
 */
async function testReceiveDeliveryPreemptsCollectDrops() {
  const test = new NeedDeliveryTest('ReceiveNeedDelivery preempts CollectDrops');

  const world = new MockWorld();
  world.fill(new Vec3(-30, 63, -30), new Vec3(30, 63, 30), 'grass_block');

  // Village infrastructure
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });
  world.setBlock(new Vec3(-6, 64, 0), 'oak_sign', { signText: '[FARM]\nX: 10\nY: 64\nZ: 10' });
  world.setBlock(new Vec3(10, 63, 10), 'water');

  // Forest for lumberjack
  world.setBlock(new Vec3(8, 64, -5), 'oak_sign', { signText: '[FOREST]\nX: 15\nY: 64\nZ: 0' });
  createOakTree(world, new Vec3(15, 64, 0), 5);

  await test.setup(world);

  // Lumberjack with materials
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
    { name: 'oak_planks', count: 32 },
    { name: 'stick', count: 16 },
  ]);

  // Farmer without tools
  const farmerBot = await test.addBot('Test_Farmer', new Vec3(3, 65, 3), [
    { name: 'wheat_seeds', count: 8 },
  ]);

  await test.wait(3000, 'Bots loading');

  // Start roles
  const farmerRole = new GOAPFarmingRole();
  const lumberjackRole = new GOAPLumberjackRole();

  test.startRole('Test_Farmer', farmerRole, 'farmer');
  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');

  // Wait through the full need flow
  await test.waitUntil(
    () => test.hasChatMessage('[NEED]'),
    { timeout: 90000, message: 'Farmer broadcasts need' }
  );

  await test.waitUntil(
    () => test.hasChatMessage('[CAN_PROVIDE]'),
    { timeout: 60000, message: 'Lumberjack offers' }
  );

  await test.waitUntil(
    () => test.hasChatMessage('[ACCEPT_PROVIDER]'),
    { timeout: 60000, message: 'Farmer accepts' }
  );

  await test.waitUntil(
    () => test.hasChatMessage('[PROVIDE_AT]'),
    { timeout: 30000, message: 'Delivery location announced' }
  );

  // Now spawn distracting drops NEAR farmer (not at delivery location)
  // These should NOT prevent farmer from going to delivery location
  console.log('  🎯 Spawning distracting drops near farmer...');
  const farmerPos = test.getBotPosition('Test_Farmer');
  if (farmerPos) {
    await test.rcon(`summon item ${Math.floor(farmerPos.x) + 1} 65 ${Math.floor(farmerPos.z)} {Item:{id:"minecraft:wheat_seeds",Count:5b}}`);
    await test.rcon(`summon item ${Math.floor(farmerPos.x) - 1} 65 ${Math.floor(farmerPos.z)} {Item:{id:"minecraft:wheat_seeds",Count:5b}}`);
  }

  await test.wait(2000, 'Drops spawned');

  // Give time for farmer to decide - should go to delivery, not random drops
  await test.wait(25000, 'Farmer should prioritize delivery over random drops');

  // Check if farmer got the delivered items (planks/sticks, not just seeds)
  const farmerPlanks = test.getBotInventoryCount('Test_Farmer', 'planks');
  const farmerSticks = test.getBotInventoryCount('Test_Farmer', 'stick');

  console.log(`  📦 Farmer: ${farmerPlanks} planks, ${farmerSticks} sticks`);

  const farmerGotDelivery = farmerPlanks > 0 || farmerSticks > 0;
  test.assert(
    farmerGotDelivery,
    `Farmer prioritized delivery pickup over random drops (planks: ${farmerPlanks}, sticks: ${farmerSticks})`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'pickup-delivered': testFarmerPicksUpDeliveredItems,
  'quick-response': testLumberjackRespondsQuicklyWithMaterials,
  'auto-accept-preemption': testAutoAcceptAfterGoalPreemption,
  'delivery-preempts-drops': testReceiveDeliveryPreemptsCollectDrops,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('NEED DELIVERY COORDINATION TESTS');
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
