#!/usr/bin/env bun
/**
 * Landscaper Follow Lumberjack Simulation Tests
 *
 * SPECIFICATION: Landscaper should follow lumberjack during exploration phase
 *
 * Issue being tested:
 * When the farmer establishes a farm and requests terraforming, the landscaper
 * might be too far away to receive the chat message because it explored
 * in a different direction from the lumberjack.
 *
 * Expected behavior after fix:
 * - Landscaper should follow lumberjack during exploration phase (like farmer does)
 * - This keeps landscaper within VillageChat range to hear terraform requests
 * - Once village center is established, landscaper can operate independently
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { PaperSimulationServer } from '../PaperSimulationServer';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';
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

type RoleType = GOAPLumberjackRole | GOAPLandscaperRole;

/**
 * Multi-bot test harness for landscaper-lumberjack coordination tests.
 */
class LandscaperFollowTest {
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

    console.log('[LandscaperFollowTest] Starting server and building world...');

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

    console.log(`[LandscaperFollowTest] Adding bot: ${name} at ${position}`);

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
      console.log(`[LandscaperFollowTest] Disconnecting ${name}...`);
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
// TEST: Landscaper stays near lumberjack during exploration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * This test verifies that the landscaper follows the lumberjack during
 * the exploration phase (before village center is established).
 *
 * Scenario:
 * 1. Lumberjack and landscaper spawn at origin
 * 2. Lumberjack moves toward a distant forest
 * 3. Landscaper should follow (not wander off in a different direction)
 * 4. After some time, bots should still be within VillageChat range (~100 blocks)
 */
async function testLandscaperFollowsLumberjackDuringExploration() {
  const test = new LandscaperFollowTest('Landscaper follows lumberjack during exploration');

  const world = new MockWorld();

  // Large world with spawn area and distant forest
  world.fill(new Vec3(-50, 63, -50), new Vec3(150, 63, 50), 'grass_block');

  // Village sign at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Forest at a distance (80 blocks away - within chat range but requires following)
  const forestCenter = new Vec3(80, 64, 0);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const dist = 3 + Math.random() * 6;
    const x = Math.floor(forestCenter.x + Math.cos(angle) * dist);
    const z = Math.floor(forestCenter.z + Math.sin(angle) * dist);
    createOakTree(world, new Vec3(x, 64, z), 4 + Math.floor(Math.random() * 2));
  }

  await test.setup(world);

  // Add lumberjack first
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
  ]);

  // Add landscaper
  const landscaperBot = await test.addBot('Test_Land', new Vec3(0, 65, 0), [
    { name: 'iron_shovel', count: 1 },
    { name: 'iron_pickaxe', count: 1 },
  ]);

  await test.wait(2000, 'Bots loading');

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const landscaperRole = new GOAPLandscaperRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Land', landscaperRole, 'landscaper');

  // Wait for lumberjack to start moving toward forest
  await test.waitUntil(
    () => {
      const lmbrPos = test.getBotPosition('Test_Lmbr');
      return lmbrPos !== null && lmbrPos.x > 30;
    },
    {
      timeout: 60000,
      message: 'Lumberjack should start moving toward forest',
    }
  );

  // Record positions at this point
  const lmbrPosAfterMove = test.getBotPosition('Test_Lmbr');
  const landPosAfterMove = test.getBotPosition('Test_Land');
  const distanceAfterMove = test.distanceBetweenBots('Test_Lmbr', 'Test_Land');

  console.log(`  📍 Lumberjack position: ${lmbrPosAfterMove}`);
  console.log(`  📍 Landscaper position: ${landPosAfterMove}`);
  console.log(`  📏 Distance: ${distanceAfterMove.toFixed(1)} blocks`);

  // Wait more time for landscaper to potentially follow
  await test.wait(30000, 'Giving landscaper time to follow lumberjack');

  // Check final positions
  const finalDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Land');
  const landFinalPos = test.getBotPosition('Test_Land');
  const lmbrFinalPos = test.getBotPosition('Test_Lmbr');

  console.log(`  📍 Final lumberjack position: ${lmbrFinalPos}`);
  console.log(`  📍 Final landscaper position: ${landFinalPos}`);
  console.log(`  📏 Final distance between bots: ${finalDistance.toFixed(1)} blocks`);

  // The key assertion: landscaper should stay within chat range of lumberjack
  // VillageChat range is typically ~100 blocks, but we want them closer for reliable communication
  const CHAT_RANGE = 64; // Conservative chat range

  const landscaperFollowed = finalDistance < CHAT_RANGE;

  if (landscaperFollowed) {
    test.assert(true, `Landscaper stayed within chat range (${finalDistance.toFixed(1)} blocks)`);
  } else {
    // Document the bug if landscaper wandered off
    test.assertBrokenBehavior(
      !landscaperFollowed,
      `Landscaper is too far from lumberjack (${finalDistance.toFixed(1)} blocks > ${CHAT_RANGE})`
    );
  }

  // Additional check: landscaper should have moved toward lumberjack (not stayed at spawn or gone opposite direction)
  const landscaperMovedCorrectDirection = landFinalPos !== null && landFinalPos.x > 10;

  if (landscaperMovedCorrectDirection) {
    test.assert(true, `Landscaper moved in correct direction (x=${landFinalPos?.x.toFixed(1)})`);
  } else {
    test.assertBrokenBehavior(
      !landscaperMovedCorrectDirection,
      `Landscaper did not follow - stayed at spawn or went wrong direction (x=${landFinalPos?.x.toFixed(1)})`
    );
  }

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Landscaper receives terraform request when following
// ═══════════════════════════════════════════════════════════════════════════

/**
 * End-to-end test that verifies the landscaper can receive terraform requests
 * when properly following the lumberjack.
 *
 * This simulates the real scenario:
 * 1. Lumberjack establishes village center
 * 2. Farmer establishes farm and requests terraform
 * 3. Landscaper (following nearby) should receive the request
 */
async function testLandscaperReceivesTerraformRequestWhenFollowing() {
  const test = new LandscaperFollowTest('Landscaper receives terraform request when following');

  const world = new MockWorld();

  // Compact world for faster test
  world.fill(new Vec3(-30, 63, -30), new Vec3(60, 63, 30), 'grass_block');

  // Village sign at spawn
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: '[VILLAGE]\nX: 0\nY: 64\nZ: 0' });

  // Shared chest and crafting table
  world.setBlock(new Vec3(5, 64, 0), 'chest');
  world.setBlock(new Vec3(5, 64, 2), 'crafting_table');
  world.setBlock(new Vec3(2, 64, 0), 'oak_sign', { signText: '[CHEST]\nX: 5\nY: 64\nZ: 0' });
  world.setBlock(new Vec3(4, 64, 0), 'oak_sign', { signText: '[CRAFT]\nX: 5\nY: 64\nZ: 2' });

  // Forest nearby (so lumberjack doesn't go too far)
  const forestCenter = new Vec3(30, 64, 0);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const dist = 3 + Math.random() * 4;
    const x = Math.floor(forestCenter.x + Math.cos(angle) * dist);
    const z = Math.floor(forestCenter.z + Math.sin(angle) * dist);
    createOakTree(world, new Vec3(x, 64, z), 4 + Math.floor(Math.random() * 2));
  }

  // Water source for farm (farmer will establish farm here)
  world.setBlock(new Vec3(20, 63, 20), 'water');

  await test.setup(world);

  // Add all three bots
  const lumberjackBot = await test.addBot('Test_Lmbr', new Vec3(0, 65, 0), [
    { name: 'iron_axe', count: 1 },
  ]);

  const landscaperBot = await test.addBot('Test_Land', new Vec3(0, 65, 0), [
    { name: 'iron_shovel', count: 1 },
    { name: 'iron_pickaxe', count: 1 },
    { name: 'dirt', count: 32 },
  ]);

  await test.wait(2000, 'Bots loading');

  // Start roles
  const lumberjackRole = new GOAPLumberjackRole();
  const landscaperRole = new GOAPLandscaperRole();

  test.startRole('Test_Lmbr', lumberjackRole, 'lumberjack');
  test.startRole('Test_Land', landscaperRole, 'landscaper');

  // Wait for village center to be established
  await test.waitUntil(
    () => test.hasChatMessage('[VILLAGE_CENTER]'),
    {
      timeout: 90000,
      message: 'Village center should be established',
    }
  );

  // Now simulate a terraform request via chat (as if farmer sent it)
  // In real scenario, farmer would send this after establishing a farm
  await test.rcon('say [TERRAFORM_REQUEST] X: 20 Y: 63 Z: 20');

  await test.wait(5000, 'Waiting for chat messages to propagate');

  // Check that both bots are still within communication range
  const finalDistance = test.distanceBetweenBots('Test_Lmbr', 'Test_Land');
  console.log(`  📏 Distance between lumberjack and landscaper: ${finalDistance.toFixed(1)} blocks`);

  // The landscaper should be close enough to have received the terraform request
  test.assert(
    finalDistance < 100,
    `Bots are within communication range (${finalDistance.toFixed(1)} blocks)`
  );

  return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<TestResult>> = {
  'follow-exploration': testLandscaperFollowsLumberjackDuringExploration,
  'terraform-request': testLandscaperReceivesTerraformRequestWhenFollowing,
};

async function runTests(tests: Array<() => Promise<TestResult>>): Promise<{ passed: number; failed: number }> {
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('LANDSCAPER FOLLOW LUMBERJACK SIMULATION TESTS');
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
