/**
 * Visual Test Harness - Watch tests execute step-by-step in prismarine-viewer.
 *
 * Usage:
 *   const harness = new VisualTestHarness();
 *   await harness.start(world, 'Test: Forest Detection');
 *
 *   await harness.step('Creating bot at origin');
 *   const bot = createBotMock({ world, position: new Vec3(0, 64, 0) });
 *   await harness.mark(bot.entity.position, 'Bot', 'lime');
 *
 *   await harness.step('Running blackboard update');
 *   await updateLumberjackBlackboard(bot, bb);
 *
 *   await harness.step(`Found ${bb.forestTrees.length} forest trees`);
 *   for (const tree of bb.forestTrees) {
 *     await harness.mark(tree.position, 'Tree', 'green');
 *   }
 *
 *   await harness.end('Test passed!');
 */

import { Vec3 } from 'vec3';
// @ts-ignore
import { standalone as standaloneViewer } from 'prismarine-viewer';
// @ts-ignore
import mcData from 'minecraft-data';
import { MockWorld } from './MockWorld';
import * as readline from 'readline';

const VERSION = '1.20.1';
let nextPort = 3007; // Auto-increment to avoid conflicts

const data = mcData(VERSION);
// @ts-ignore
const World = require('prismarine-world')(VERSION);
// @ts-ignore
const Chunk = require('prismarine-chunk')(VERSION);

// Marker colors mapped to concrete block types
const MARKER_COLORS: Record<string, string> = {
  red: 'red_concrete',
  green: 'green_concrete',
  blue: 'blue_concrete',
  yellow: 'yellow_concrete',
  lime: 'lime_concrete',
  orange: 'orange_concrete',
  magenta: 'magenta_concrete',
  cyan: 'cyan_concrete',
  white: 'white_concrete',
  black: 'black_concrete',
};

// Log blocks that need vertical orientation (axis=y)
const LOG_BLOCKS = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
]);

function getBlockStateId(blockName: string): number {
  if (blockName === 'air') return 0;
  const block = data.blocksByName[blockName];
  if (!block) {
    console.warn(`Unknown block: ${blockName}, using stone`);
    return data.blocksByName['stone']?.minStateId ?? 1;
  }
  // For log blocks, add 1 to get axis=y (vertical) orientation
  if (LOG_BLOCKS.has(blockName)) {
    return (block.minStateId ?? block.id ?? 0) + 1;
  }
  return block.minStateId ?? block.id ?? 0;
}

interface Marker {
  position: Vec3;
  label: string;
  color: string;
  originalBlock: string;
}

export class VisualTestHarness {
  private mockWorld: MockWorld | null = null;
  private prismarineWorld: any = null;
  private viewer: any = null;
  private markers: Marker[] = [];
  private stepIndex: number = 0;
  private testName: string = '';
  private autoAdvance: boolean = false;
  private autoAdvanceDelay: number = 1000;
  private rl: readline.Interface | null = null;
  private currentPort: number = 3007;
  private liveBlockMap: Map<string, string> = new Map(); // Shared with prismarine world

  /**
   * Start the visual test harness.
   * Opens the viewer and displays the initial world state.
   */
  async start(world: MockWorld, testName: string, options?: {
    autoAdvance?: boolean;
    delay?: number;
    center?: Vec3;
  }): Promise<void> {
    this.mockWorld = world;
    this.testName = testName;
    this.stepIndex = 0;
    this.markers = [];
    this.autoAdvance = options?.autoAdvance ?? false;
    this.autoAdvanceDelay = options?.delay ?? 1000;

    // Create prismarine world from MockWorld
    this.prismarineWorld = this.createPrismarineWorld();

    // Start viewer on next available port
    const port = nextPort++;
    const center = options?.center ?? new Vec3(0, 70, 0);
    this.viewer = standaloneViewer({
      version: VERSION,
      world: this.prismarineWorld,
      center,
      port,
      viewDistance: 4,
    });
    this.currentPort = port;

    // Setup readline for step control
    if (!this.autoAdvance) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log(`VISUAL TEST: ${testName}`);
    console.log('='.repeat(60));
    console.log(`Viewer: http://localhost:${this.currentPort}`);
    console.log('Controls: [Enter] next step, [a] auto-advance, [q] quit');
    console.log('='.repeat(60) + '\n');

    // Wait for chunks to load before accepting input
    await this.delay(500);

    await this.waitForInput('Press Enter to begin...');
  }

  /**
   * Display a step message and wait for user input.
   */
  async step(message: string): Promise<void> {
    this.stepIndex++;
    const stepLabel = `[Step ${this.stepIndex}]`;

    // Update viewer with current world state
    await this.refreshViewer();

    console.log(`\n${stepLabel} ${message}`);

    if (this.autoAdvance) {
      await this.delay(this.autoAdvanceDelay);
    } else {
      await this.waitForInput('');
    }
  }

  /**
   * Mark a position in the world with a colored beacon.
   * The marker will be visible as a column of colored blocks.
   */
  async mark(position: Vec3, label: string, color: string = 'lime'): Promise<void> {
    if (!this.mockWorld) return;

    const blockName = MARKER_COLORS[color] ?? 'lime_concrete';
    // Handle both Vec3 with floored() and plain objects
    const pos = new Vec3(
      Math.floor(position.x),
      Math.floor(position.y),
      Math.floor(position.z)
    );

    // Store original block
    const originalBlock = this.mockWorld.blockAt(pos)?.name ?? 'air';

    // Place marker as a tall pillar from ground to above canopy
    // This makes it visible from any angle
    const groundY = 63; // Standard ground level
    const pillarHeight = 20;

    for (let y = groundY; y < groundY + pillarHeight; y++) {
      const markerPos = new Vec3(pos.x, y, pos.z);
      this.mockWorld.setBlock(markerPos, blockName);
    }

    // Add glowstone on top for visibility
    this.mockWorld.setBlock(new Vec3(pos.x, groundY + pillarHeight, pos.z), 'glowstone');

    this.markers.push({ position: pos, label, color, originalBlock });

    console.log(`  📍 Marked: ${label} at (${pos.x}, ${pos.y}, ${pos.z}) [${color}]`);

    await this.refreshViewer();
  }

  /**
   * Mark multiple positions with the same color.
   */
  async markMany(positions: Vec3[], label: string, color: string = 'green'): Promise<void> {
    for (let i = 0; i < positions.length; i++) {
      await this.mark(positions[i]!, `${label} #${i + 1}`, color);
    }
  }

  /**
   * Highlight a region (outline with markers).
   */
  async highlightRegion(from: Vec3, to: Vec3, label: string, color: string = 'yellow'): Promise<void> {
    if (!this.mockWorld) return;

    const blockName = MARKER_COLORS[color] ?? 'yellow_concrete';
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minZ = Math.min(from.z, to.z);
    const maxZ = Math.max(from.z, to.z);
    const y = Math.max(from.y, to.y) + 1;

    // Draw outline at corners
    const corners = [
      new Vec3(minX, y, minZ),
      new Vec3(maxX, y, minZ),
      new Vec3(minX, y, maxZ),
      new Vec3(maxX, y, maxZ),
    ];

    for (const corner of corners) {
      this.mockWorld.setBlock(corner, blockName);
      this.mockWorld.setBlock(corner.offset(0, 1, 0), blockName);
    }

    console.log(`  📐 Region: ${label} (${minX},${minZ}) to (${maxX},${maxZ})`);
    await this.refreshViewer();
  }

  /**
   * Clear all markers.
   */
  async clearMarkers(): Promise<void> {
    if (!this.mockWorld) return;

    const groundY = 63;
    const pillarHeight = 21; // Include glowstone top

    for (const marker of this.markers) {
      // Remove pillar
      for (let y = groundY; y < groundY + pillarHeight; y++) {
        const clearPos = new Vec3(marker.position.x, y, marker.position.z);
        this.mockWorld.setBlock(clearPos, 'air');
      }
    }

    this.markers = [];
    console.log('  🧹 Cleared all markers');
    await this.refreshViewer();
  }

  /**
   * Show an assertion result.
   */
  async assert(condition: boolean, message: string): Promise<void> {
    const icon = condition ? '✅' : '❌';
    console.log(`  ${icon} Assert: ${message}`);

    if (!condition) {
      await this.step('ASSERTION FAILED - Check the viewer');
    }
  }

  /**
   * Show a value for inspection.
   */
  async inspect(label: string, value: any): Promise<void> {
    const formatted = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    console.log(`  🔍 ${label}: ${formatted}`);
  }

  /**
   * End the test and close the harness.
   */
  async end(message: string = 'Test complete'): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`✨ ${message}`);
    console.log('='.repeat(60));

    await this.waitForInput('Press Enter to close viewer...');

    this.cleanup();
  }

  /**
   * End the test with a failure.
   */
  async fail(message: string): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`💥 TEST FAILED: ${message}`);
    console.log('='.repeat(60));

    await this.waitForInput('Press Enter to close viewer...');

    this.cleanup();
    throw new Error(message);
  }

  private createPrismarineWorld(): any {
    if (!this.mockWorld) throw new Error('No MockWorld set');

    // Sync MockWorld to our live block map
    this.syncBlockMap();

    // Create world that reads from the live block map (can be updated later)
    const blockMap = this.liveBlockMap;

    return new World((chunkX: number, chunkZ: number) => {
      const chunk = new Chunk();

      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 16; x++) {
          for (let z = 0; z < 16; z++) {
            const worldX = chunkX * 16 + x;
            const worldZ = chunkZ * 16 + z;
            const key = `${worldX},${y},${worldZ}`;

            const blockName = blockMap.get(key) ?? 'air';
            const stateId = getBlockStateId(blockName);

            chunk.setBlockStateId(new Vec3(x, y, z), stateId);
          }
        }
      }

      return chunk;
    });
  }

  private syncBlockMap(): void {
    if (!this.mockWorld) return;

    this.liveBlockMap.clear();
    for (const block of this.mockWorld.getAllBlocks()) {
      const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      this.liveBlockMap.set(key, block.name);
    }
  }

  private async refreshViewer(): Promise<void> {
    if (!this.mockWorld || !this.prismarineWorld) return;

    // Sync MockWorld changes to our blockMap
    this.syncBlockMap();

    // Update all blocks in the prismarine world
    // This works for already-loaded chunks
    for (const [key, blockName] of this.liveBlockMap) {
      const [x, y, z] = key.split(',').map(Number);
      const pos = new Vec3(x, y, z);
      const stateId = getBlockStateId(blockName);
      try {
        await this.prismarineWorld.setBlockStateId(pos, stateId);
      } catch (e) {
        // Block might be in unloaded chunk, ignore
      }
    }

    // Trigger viewer update
    if (this.viewer && typeof this.viewer.update === 'function') {
      this.viewer.update();
    }
  }

  private async waitForInput(prompt: string): Promise<void> {
    if (this.autoAdvance) {
      console.log(prompt || '(auto-advancing...)');
      await this.delay(this.autoAdvanceDelay);
      return;
    }

    return new Promise((resolve) => {
      if (!this.rl) {
        resolve();
        return;
      }

      this.rl.question(prompt || '> ', (answer) => {
        if (answer.toLowerCase() === 'q') {
          this.cleanup();
          process.exit(0);
        } else if (answer.toLowerCase() === 'a') {
          this.autoAdvance = true;
          console.log('Auto-advance enabled (1s delay)');
        }
        resolve();
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private cleanup(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    // Close the viewer server
    if (this.viewer) {
      try {
        // prismarine-viewer returns an object with close() or the server itself
        if (typeof this.viewer.close === 'function') {
          this.viewer.close();
        } else if (this.viewer.server && typeof this.viewer.server.close === 'function') {
          this.viewer.server.close();
        }
      } catch (e) {
        // Ignore close errors
      }
      this.viewer = null;
    }
  }
}

/**
 * Helper to run a visual test from command line.
 */
export async function runVisualTest(
  name: string,
  testFn: (harness: VisualTestHarness) => Promise<void>,
  options?: { autoAdvance?: boolean; delay?: number }
): Promise<void> {
  const harness = new VisualTestHarness();

  try {
    await testFn(harness);
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  }
}
