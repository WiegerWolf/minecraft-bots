/**
 * SimulationTest - Automated testing framework for bot behavior
 *
 * Run real integration tests against a Paper server with assertions
 * on bot behavior, inventory, world state, and more.
 *
 * Usage:
 * ```typescript
 * const test = new SimulationTest('Lumberjack chops trees');
 *
 * await test.setup(world, {
 *   botPosition: new Vec3(0, 65, 0),
 *   botInventory: [{ name: 'iron_axe', count: 1 }],
 * });
 *
 * // Start the bot's role
 * const role = new GOAPLumberjackRole();
 * role.start(test.bot);
 *
 * // Wait for conditions and assert
 * await test.waitUntil(() => test.botInventoryCount('oak_log') >= 4, {
 *   timeout: 60000,
 *   message: 'Bot should collect at least 4 logs',
 * });
 *
 * await test.assertNear(new Vec3(15, 64, 15), 10, 'Bot should be near the forest');
 *
 * await test.cleanup();
 * ```
 */

import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { PaperSimulationServer, type SimulationOptions } from './PaperSimulationServer';
import { MockWorld } from '../mocks/MockWorld';
import { createTestLogger, generateSessionId, type Logger } from '../../src/shared/logger';

export interface WaitOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Check interval in milliseconds (default: 500) */
  interval?: number;
  /** Message to show on timeout failure */
  message?: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  assertions: AssertionResult[];
}

export interface AssertionResult {
  description: string;
  passed: boolean;
  error?: string;
}

// Shared session ID for all tests in a single run
// Set by runSimulationTests() or initTestSession()
let currentTestSessionId: string | null = null;

/**
 * Initialize a test session with a shared session ID.
 * Called automatically by runSimulationTests(), but can be called
 * manually for standalone tests.
 *
 * If SIM_TEST_SESSION_ID env var is set (from run-all-tests.ts parent process),
 * uses that to ensure all test suites share the same log directory.
 */
export function initTestSession(): string {
  if (!currentTestSessionId) {
    // Check for parent-provided session ID (from run-all-tests.ts)
    currentTestSessionId = process.env.SIM_TEST_SESSION_ID || `test-${generateSessionId()}`;
    // Suppress TUI state emission during tests
    process.env.SUPPRESS_TUI_STATE = 'true';
  }
  return currentTestSessionId;
}

/**
 * Get the current test session ID.
 */
export function getTestSessionId(): string {
  return currentTestSessionId || initTestSession();
}

/**
 * Clear the test session (for cleanup between test suite runs).
 */
export function clearTestSession(): void {
  currentTestSessionId = null;
  delete process.env.SUPPRESS_TUI_STATE;
}

export class SimulationTest {
  readonly name: string;
  private server: PaperSimulationServer | null = null;
  private _bot: Bot | null = null;
  private assertions: AssertionResult[] = [];
  private startTime: number = 0;
  private failed: boolean = false;

  // Logging
  private _sessionId: string;
  private _logger: Logger | null = null;
  private _logFile: string | null = null;

  constructor(name: string) {
    this.name = name;
    // Use shared session ID for all tests in a run
    this._sessionId = getTestSessionId();
  }

  /**
   * Get the test session ID for logs.
   */
  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Get the logger instance for this test.
   * Use this when starting roles: role.start(test.bot, { logger: test.logger })
   */
  get logger(): Logger | null {
    return this._logger;
  }

  /**
   * Get the log file path for verification.
   */
  get logFile(): string | null {
    return this._logFile;
  }

  /**
   * Create a logger for a specific role in this test.
   * The logger writes to the test's own log file (based on test name),
   * not a generic role-named file like 'landscaper.log'.
   */
  createRoleLogger(roleName: string, _roleLabel?: string): Logger {
    // Use test name (kebab-cased) for the log file so each test gets its own logs
    const testNameKebab = this.name.replace(/\s+/g, '-').toLowerCase();
    const result = createTestLogger({
      botName: 'SimBot',
      role: roleName,
      roleLabel: testNameKebab,
      sessionId: this._sessionId,
    });
    return result.logger;
  }

  /**
   * Get the bot instance.
   */
  get bot(): Bot {
    if (!this._bot) throw new Error('Test not set up - call setup() first');
    return this._bot;
  }

  /**
   * Get the simulation server instance.
   */
  get sim(): PaperSimulationServer {
    if (!this.server) throw new Error('Test not set up - call setup() first');
    return this.server;
  }

  /**
   * Set up the test scenario.
   */
  async setup(world: MockWorld, options?: SimulationOptions): Promise<void> {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`TEST: ${this.name}`);
    console.log(`${'─'.repeat(60)}\n`);

    this.startTime = Date.now();

    // Create default test logger
    const logResult = createTestLogger({
      botName: 'SimBot',
      role: 'test',
      roleLabel: this.name.replace(/\s+/g, '-').toLowerCase(),
      sessionId: this._sessionId,
    });
    this._logger = logResult.logger;
    this._logFile = logResult.logFile;
    this.assertions = [];
    this.failed = false;

    this.server = new PaperSimulationServer();
    this._bot = await this.server.start(world, {
      enableViewer: false,  // Use Minecraft client instead
      openBrowser: false,
      waitForPlayer: true,  // Wait for player to join before starting test
      testName: this.name,  // Display test name in game chat
      ...options,
    });
  }

  /**
   * Clean up after test.
   */
  async cleanup(): Promise<TestResult> {
    const duration = Date.now() - this.startTime;
    const passed = !this.failed && this.assertions.every(a => a.passed);

    const result: TestResult = {
      name: this.name,
      passed,
      duration,
      assertions: this.assertions,
    };

    // Print summary
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

    // Cleanup
    if (this.server) {
      await this.server.stop();
      this.server = null;
      this._bot = null;
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WAIT HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Wait until a condition is true.
   */
  async waitUntil(
    condition: () => boolean | Promise<boolean>,
    options: WaitOptions = {}
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
   * Wait for a specific duration.
   */
  async wait(ms: number, reason?: string): Promise<void> {
    if (reason) {
      console.log(`  ⏳ Waiting ${ms}ms: ${reason}`);
    }
    await this.delay(ms);
  }

  /**
   * Wait until bot has at least N of an item.
   */
  async waitForInventory(
    itemName: string,
    minCount: number,
    options: WaitOptions = {}
  ): Promise<boolean> {
    return this.waitUntil(
      () => this.botInventoryCount(itemName) >= minCount,
      {
        message: `Bot should have at least ${minCount} ${itemName}`,
        ...options,
      }
    );
  }

  /**
   * Wait until bot is near a position.
   */
  async waitForPosition(
    pos: Vec3,
    maxDistance: number,
    options: WaitOptions = {}
  ): Promise<boolean> {
    return this.waitUntil(
      () => this.botDistanceTo(pos) <= maxDistance,
      {
        message: `Bot should be within ${maxDistance} blocks of (${pos.x}, ${pos.y}, ${pos.z})`,
        ...options,
      }
    );
  }

  /**
   * Wait until a block at position is a specific type.
   */
  async waitForBlock(
    pos: Vec3,
    blockName: string,
    options: WaitOptions = {}
  ): Promise<boolean> {
    return this.waitUntil(
      () => this.blockAt(pos) === blockName,
      {
        message: `Block at (${pos.x}, ${pos.y}, ${pos.z}) should be ${blockName}`,
        ...options,
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assert that bot is near a position.
   */
  assertNear(pos: Vec3, maxDistance: number, message?: string): boolean {
    const distance = this.botDistanceTo(pos);
    const passed = distance <= maxDistance;
    const desc = message || `Bot should be within ${maxDistance} blocks of (${pos.x}, ${pos.y}, ${pos.z})`;
    this.recordAssertion(desc, passed, passed ? undefined : `Distance: ${distance.toFixed(1)}`);
    return passed;
  }

  /**
   * Assert bot has at least N of an item.
   */
  assertInventory(itemName: string, minCount: number, message?: string): boolean {
    const count = this.botInventoryCount(itemName);
    const passed = count >= minCount;
    const desc = message || `Bot should have at least ${minCount} ${itemName}`;
    this.recordAssertion(desc, passed, passed ? undefined : `Actual: ${count}`);
    return passed;
  }

  /**
   * Assert a block at position is a specific type.
   */
  assertBlock(pos: Vec3, blockName: string, message?: string): boolean {
    const actual = this.blockAt(pos);
    const passed = actual === blockName;
    const desc = message || `Block at (${pos.x}, ${pos.y}, ${pos.z}) should be ${blockName}`;
    this.recordAssertion(desc, passed, passed ? undefined : `Actual: ${actual}`);
    return passed;
  }

  /**
   * Assert that a condition is true.
   */
  assert(condition: boolean, message: string): boolean {
    this.recordAssertion(message, condition);
    return condition;
  }

  /**
   * Assert that two values are equal.
   */
  assertEqual<T>(actual: T, expected: T, message: string): boolean {
    const passed = actual === expected;
    this.recordAssertion(message, passed, passed ? undefined : `Expected: ${expected}, Actual: ${actual}`);
    return passed;
  }

  /**
   * Assert that a value is greater than another.
   */
  assertGreater(actual: number, expected: number, message: string): boolean {
    const passed = actual > expected;
    this.recordAssertion(message, passed, passed ? undefined : `Expected > ${expected}, Actual: ${actual}`);
    return passed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get count of an item in bot's inventory.
   */
  botInventoryCount(itemName: string): number {
    if (!this._bot) return 0;
    const items = this._bot.inventory.items();
    return items
      .filter(item => item.name === itemName)
      .reduce((sum, item) => sum + item.count, 0);
  }

  /**
   * Get bot's distance to a position.
   */
  botDistanceTo(pos: Vec3): number {
    if (!this._bot?.entity?.position) return Infinity;
    return this._bot.entity.position.distanceTo(pos);
  }

  /**
   * Get bot's current position.
   */
  botPosition(): Vec3 | null {
    return this._bot?.entity?.position?.clone() || null;
  }

  /**
   * Get the block name at a position.
   */
  blockAt(pos: Vec3): string {
    if (!this._bot) return 'unknown';
    const block = this._bot.blockAt(pos);
    return block?.name || 'air';
  }

  /**
   * Get bot's health.
   */
  botHealth(): number {
    return this._bot?.health || 0;
  }

  /**
   * Get bot's food level.
   */
  botFood(): number {
    return this._bot?.food || 0;
  }

  /**
   * Check if bot is currently pathfinding.
   */
  botIsMoving(): boolean {
    return this._bot?.pathfinder?.isMoving() || false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send a chat message as the bot.
   */
  chat(message: string): void {
    this._bot?.chat(message);
  }

  /**
   * Execute an RCON command.
   */
  async rcon(command: string): Promise<string> {
    if (!this.server) throw new Error('Test not set up');
    return this.server.rconCommand(command);
  }

  /**
   * Teleport the bot to a position.
   */
  async teleportBot(pos: Vec3): Promise<void> {
    await this.rcon(`tp SimBot ${pos.x} ${pos.y} ${pos.z}`);
    await this.delay(100);
  }

  /**
   * Give an item to the bot.
   */
  async giveItem(itemName: string, count: number = 1): Promise<void> {
    await this.rcon(`give SimBot minecraft:${itemName} ${count}`);
    await this.delay(100);
  }

  /**
   * Set a block in the world.
   */
  async setBlock(pos: Vec3, blockName: string): Promise<void> {
    await this.rcon(`setblock ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)} minecraft:${blockName}`);
  }

  /**
   * Get the count of a specific item in a chest at a position.
   * Uses RCON to query the chest's NBT data.
   */
  async getChestItemCount(pos: Vec3, itemName: string): Promise<number> {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);

    try {
      // Get the chest's Items NBT data
      const result = await this.rcon(`data get block ${x} ${y} ${z} Items`);

      // Parse the result - formats vary by Minecraft version:
      // Old: "{...block data: [{Slot: 0b, id: "minecraft:oak_log", count: 32}]"
      // New: "{...block data: [{Slot: 0b, count: 32, id: "minecraft:oak_log"}]"
      // Newer: May use Count: (capitalized) or different ordering

      // Try multiple patterns to handle different NBT formats
      let total = 0;

      // Pattern 1: id before count (old format)
      const pattern1 = new RegExp(`id:\\s*"minecraft:${itemName}"[^}]*?count:\\s*(\\d+)`, 'gi');
      let match;
      while ((match = pattern1.exec(result)) !== null) {
        total += parseInt(match[1]!, 10);
      }

      // Pattern 2: count before id (newer format)
      if (total === 0) {
        const pattern2 = new RegExp(`count:\\s*(\\d+)[^}]*?id:\\s*"minecraft:${itemName}"`, 'gi');
        while ((match = pattern2.exec(result)) !== null) {
          total += parseInt(match[1]!, 10);
        }
      }

      // Debug: always log RCON response for chest queries if no items found
      if (total === 0) {
        const hasItem = result.includes(itemName);
        const isEmpty = result.includes('block data: []') || result.includes('Items: []');
        if (hasItem) {
          console.log(`  🔍 RCON found '${itemName}' in response but regex didn't match. Response: ${result.slice(0, 500)}`);
        } else if (!isEmpty) {
          console.log(`  📦 RCON chest response (looking for ${itemName}): ${result.slice(0, 300)}`);
        }
      }

      return total;
    } catch (err) {
      console.log(`  ⚠ Could not read chest at (${x}, ${y}, ${z}): ${err}`);
      return 0;
    }
  }

  /**
   * Assert that a chest contains at least N of an item.
   */
  async assertChestContains(pos: Vec3, itemName: string, minCount: number, message?: string): Promise<boolean> {
    const count = await this.getChestItemCount(pos, itemName);
    const passed = count >= minCount;
    const desc = message || `Chest at (${pos.x}, ${pos.y}, ${pos.z}) should have at least ${minCount} ${itemName}`;
    this.recordAssertion(desc, passed, passed ? undefined : `Actual: ${count}`);
    return passed;
  }

  /**
   * Wait until a chest contains at least N of an item.
   */
  async waitForChestContains(
    pos: Vec3,
    itemName: string,
    minCount: number,
    options: WaitOptions = {}
  ): Promise<boolean> {
    return this.waitUntil(
      async () => (await this.getChestItemCount(pos, itemName)) >= minCount,
      {
        message: `Chest at (${pos.x}, ${pos.y}, ${pos.z}) should have at least ${minCount} ${itemName}`,
        ...options,
      }
    );
  }

  /**
   * Read sign text at a position via RCON.
   * Returns the front text lines as an array.
   */
  async readSignText(pos: Vec3): Promise<string[]> {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);

    try {
      const result = await this.rcon(`data get block ${x} ${y} ${z} front_text.messages`);
      // Result looks like: Block data: ['{"text":"[CHEST]"}', '{"text":"X: -5"}', ...]
      const matches = result.matchAll(/"text":\s*"([^"]*)"/g);
      const lines: string[] = [];
      for (const match of matches) {
        lines.push(match[1]!);
      }
      return lines;
    } catch (err) {
      console.log(`  ⚠ Could not read sign at (${x}, ${y}, ${z}): ${err}`);
      return [];
    }
  }

  /**
   * Debug helper to dump sign text from a position.
   */
  async debugSign(pos: Vec3, label?: string): Promise<void> {
    const lines = await this.readSignText(pos);
    console.log(`  📜 Sign${label ? ` (${label})` : ''} at (${pos.x}, ${pos.y}, ${pos.z}):`);
    for (const line of lines) {
      console.log(`     "${line}"`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Run multiple simulation tests in sequence.
 */
export async function runSimulationTests(
  tests: Array<() => Promise<TestResult>>
): Promise<{ passed: number; failed: number; results: TestResult[] }> {
  // Initialize shared session for all tests in this run
  const sessionId = initTestSession();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n' + '═'.repeat(60));
  console.log('SIMULATION TEST SUITE');
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
      results.push({
        name: 'Unknown test',
        passed: false,
        duration: 0,
        error: String(err),
        assertions: [],
      });
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`Logs: logs/${sessionId}/`);
  console.log('═'.repeat(60) + '\n');

  // Clean up session for next run
  clearTestSession();

  return { passed, failed, results };
}
