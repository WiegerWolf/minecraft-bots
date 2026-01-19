/**
 * Visual Test Server - Browser-based test runner with WebSocket control.
 *
 * This replaces the terminal-based VisualTestHarness with a browser UI.
 * The browser shows the 3D viewer and test controls side-by-side.
 */

import { Vec3 } from 'vec3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import { standalone as standaloneViewer } from 'prismarine-viewer';
// @ts-ignore
import mcData from 'minecraft-data';
import { MockWorld } from './MockWorld';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = '1.21.4' as const;

const data = mcData(VERSION);
// @ts-ignore
const World = require('prismarine-world')(VERSION);
// @ts-ignore
const Chunk = require('prismarine-chunk')(VERSION);

// Log blocks that need vertical orientation (axis=y)
const LOG_BLOCKS = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
]);

function getBlockStateId(blockName: string): number {
  if (blockName === 'air') return 0;
  const block = data.blocksByName[blockName];
  if (!block) return data.blocksByName['stone']?.minStateId ?? 1;
  if (LOG_BLOCKS.has(blockName)) {
    return (block.minStateId ?? block.id ?? 0) + 1;
  }
  return block.minStateId ?? block.id ?? 0;
}

interface Marker {
  position: Vec3;
  label: string;
  color: string;
}

// Marker colors
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

export class VisualTestServer {
  private mockWorld: MockWorld | null = null;
  private prismarineWorld: any = null;
  private viewer: any = null;
  private markers: Marker[] = [];
  private stepIndex: number = 0;
  private testName: string = '';
  private liveBlockMap: Map<string, string> = new Map();

  private uiServer: any = null;
  private wsClients: Set<WebSocket> = new Set();
  private waitingResolve: (() => void) | null = null;

  private viewerPort: number = 3010;
  private uiPort: number = 3008;
  private browserOpened: boolean = false;

  /**
   * Start the visual test server.
   */
  async start(world: MockWorld, testName: string, options?: {
    center?: Vec3;
  }): Promise<void> {
    this.mockWorld = world;
    this.testName = testName;
    this.stepIndex = 0;
    this.markers = [];

    // Sync blocks
    this.syncBlockMap();

    // Create prismarine world
    this.prismarineWorld = this.createPrismarineWorld();

    // Start viewer on its port
    const center = options?.center ?? new Vec3(0, 70, 0);
    this.viewer = standaloneViewer({
      version: VERSION as any,
      world: this.prismarineWorld,
      center,
      port: this.viewerPort,
      viewDistance: 4,
    });

    // Start UI server if not already running
    if (!this.uiServer) {
      await this.startUIServer();
    }

    // Open browser on first test
    if (!this.browserOpened) {
      this.browserOpened = true;
      const url = `http://localhost:${this.uiPort}?port=${this.uiPort}`;
      console.log(`\nOpening browser: ${url}\n`);

      // Open browser
      const { exec } = await import('child_process');
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} "${url}"`);

      // Wait for browser to connect
      await this.waitForConnection();
    }

    // Notify browser of new test
    this.broadcast({
      type: 'test-start',
      testName,
      viewerPort: this.viewerPort,
    });

    // Wait a moment for viewer to load
    await this.delay(500);
  }

  /**
   * Display a step and wait for user to advance.
   */
  async step(message: string): Promise<void> {
    this.stepIndex++;

    await this.refreshViewer();

    this.broadcast({
      type: 'step',
      stepNumber: this.stepIndex,
      message,
    });

    console.log(`[Step ${this.stepIndex}] ${message}`);

    await this.waitForNext();
  }

  /**
   * Mark a position with a colored pillar placed adjacent to it (not on top).
   * This avoids overwriting the block being marked.
   */
  async mark(position: Vec3, label: string, color: string = 'lime'): Promise<void> {
    if (!this.mockWorld) return;

    const blockName = MARKER_COLORS[color] ?? 'lime_concrete';
    const pos = new Vec3(
      Math.floor(position.x),
      Math.floor(position.y),
      Math.floor(position.z)
    );

    // Place marker pillar offset by 0.5 blocks diagonally (at corner)
    // This way it's visually next to the block without overwriting it
    const markerX = pos.x + 0.5;
    const markerZ = pos.z + 0.5;

    // Create a small beacon above the marked position instead of a full pillar
    // Just place glowstone + colored block above the target
    const markerY = pos.y + 3;
    this.mockWorld.setBlock(new Vec3(pos.x, markerY, pos.z), blockName);
    this.mockWorld.setBlock(new Vec3(pos.x, markerY + 1, pos.z), blockName);
    this.mockWorld.setBlock(new Vec3(pos.x, markerY + 2, pos.z), 'glowstone');

    this.markers.push({ position: pos, label, color });

    this.broadcast({
      type: 'mark',
      label,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color,
    });

    console.log(`  📍 ${label} at (${pos.x}, ${pos.y}, ${pos.z})`);

    await this.refreshViewer();
  }

  /**
   * Mark multiple positions.
   */
  async markMany(positions: Vec3[], label: string, color: string = 'green'): Promise<void> {
    for (let i = 0; i < positions.length; i++) {
      await this.mark(positions[i]!, `${label} #${i + 1}`, color);
    }
  }

  /**
   * Clear all markers.
   */
  async clearMarkers(): Promise<void> {
    if (!this.mockWorld) return;

    for (const marker of this.markers) {
      const pos = marker.position;
      const markerY = pos.y + 3;
      // Clear the small beacon (3 blocks)
      this.mockWorld.setBlock(new Vec3(pos.x, markerY, pos.z), 'air');
      this.mockWorld.setBlock(new Vec3(pos.x, markerY + 1, pos.z), 'air');
      this.mockWorld.setBlock(new Vec3(pos.x, markerY + 2, pos.z), 'air');
    }

    this.markers = [];
    this.broadcast({ type: 'clear-markers' });
    console.log('  🧹 Cleared markers');

    await this.refreshViewer();
  }

  /**
   * Show a value for inspection.
   */
  async inspect(label: string, value: any): Promise<void> {
    const formatted = typeof value === 'object' ? JSON.stringify(value) : String(value);
    this.broadcast({
      type: 'inspect',
      label,
      value: formatted,
    });
    console.log(`  🔍 ${label}: ${formatted}`);
  }

  /**
   * Show assertion result.
   */
  async assert(condition: boolean, message: string): Promise<void> {
    this.broadcast({
      type: 'assert',
      passed: condition,
      message,
    });
    console.log(`  ${condition ? '✅' : '❌'} ${message}`);

    if (!condition) {
      await this.step('ASSERTION FAILED - Check the viewer');
    }
  }

  /**
   * End the test.
   */
  async end(message: string = 'Test complete'): Promise<void> {
    this.broadcast({
      type: 'test-end',
      message,
    });
    console.log(`\n✨ ${message}\n`);

    // Close viewer for this test
    this.closeViewer();

    // Increment port for next test
    this.viewerPort++;
  }

  /**
   * End with failure.
   */
  async fail(message: string): Promise<void> {
    await this.end(`FAILED: ${message}`);
    throw new Error(message);
  }

  /**
   * Shutdown everything.
   */
  async shutdown(): Promise<void> {
    this.closeViewer();
    if (this.uiServer) {
      this.uiServer.stop();
      this.uiServer = null;
    }
  }

  // --- Private methods ---

  private async startUIServer(): Promise<void> {
    const htmlPath = join(__dirname, '../visual/ui/index.html');
    const html = readFileSync(htmlPath, 'utf-8');

    this.uiServer = Bun.serve({
      port: this.uiPort,
      fetch: (req, server) => {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (url.pathname === '/ws' || req.headers.get('upgrade') === 'websocket') {
          const upgraded = server.upgrade(req);
          if (!upgraded) {
            return new Response('WebSocket upgrade failed', { status: 400 });
          }
          return undefined;
        }

        // Serve HTML
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      },
      websocket: {
        open: (ws) => {
          this.wsClients.add(ws as unknown as WebSocket);
          console.log('Browser connected');
        },
        close: (ws) => {
          this.wsClients.delete(ws as unknown as WebSocket);
        },
        message: (ws, message) => {
          try {
            const msg = JSON.parse(message.toString());
            if (msg.type === 'next' && this.waitingResolve) {
              this.waitingResolve();
              this.waitingResolve = null;
            }
          } catch (e) {
            // Ignore parse errors
          }
        },
      },
    });

    console.log(`UI server running on http://localhost:${this.uiPort}`);
  }

  private broadcast(msg: object): void {
    const data = JSON.stringify(msg);
    for (const client of this.wsClients) {
      try {
        (client as any).send(data);
      } catch (e) {
        // Client disconnected
      }
    }
  }

  private waitForConnection(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.wsClients.size > 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private waitForNext(): Promise<void> {
    return new Promise((resolve) => {
      this.broadcast({ type: 'waiting' });
      this.waitingResolve = resolve;
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private syncBlockMap(): void {
    if (!this.mockWorld) return;
    this.liveBlockMap.clear();
    for (const block of this.mockWorld.getAllBlocks()) {
      const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      this.liveBlockMap.set(key, block.name);
    }
  }

  private createPrismarineWorld(): any {
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

  private async refreshViewer(): Promise<void> {
    if (!this.mockWorld || !this.prismarineWorld) return;

    this.syncBlockMap();

    for (const [key, blockName] of this.liveBlockMap) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const pos = new Vec3(x, y, z);
      const stateId = getBlockStateId(blockName);
      try {
        await this.prismarineWorld.setBlockStateId(pos, stateId);
      } catch (e) {
        // Ignore
      }
    }

    if (this.viewer?.update) {
      this.viewer.update();
    }
  }

  private closeViewer(): void {
    if (this.viewer) {
      try {
        if (typeof this.viewer.close === 'function') {
          this.viewer.close();
        }
      } catch (e) {
        // Ignore
      }
      this.viewer = null;
    }
  }
}

// Singleton instance for running tests
let serverInstance: VisualTestServer | null = null;

export function getVisualTestServer(): VisualTestServer {
  if (!serverInstance) {
    serverInstance = new VisualTestServer();
  }
  return serverInstance;
}
