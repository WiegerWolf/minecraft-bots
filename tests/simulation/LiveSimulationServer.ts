/**
 * LiveSimulationServer - Run bot logic against a real flying-squid server
 * with custom world definitions.
 *
 * This allows testing bot behavior with real Minecraft physics, pathfinding,
 * and game mechanics while still having full control over the world setup.
 *
 * Usage:
 * ```typescript
 * const sim = new LiveSimulationServer();
 *
 * // Define your world (same API as MockWorld)
 * const world = new MockWorld();
 * world.fill(new Vec3(-10, 63, -10), new Vec3(10, 63, 10), 'grass_block');
 * createOakTree(world, new Vec3(0, 64, 0), 5);
 *
 * // Start simulation
 * await sim.start(world, {
 *   botPosition: new Vec3(5, 64, 5),
 *   botInventory: [{ name: 'diamond_axe', count: 1 }],
 *   gameMode: 'survival',
 * });
 *
 * // Access the real bot
 * const bot = sim.getBot();
 *
 * // Run your GOAP loop or watch behavior
 * // ...
 *
 * await sim.stop();
 * ```
 */

import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { MockWorld } from '../mocks/MockWorld';

// @ts-ignore - flying-squid types
import flyingSquid from 'flying-squid';
// @ts-ignore
import mineflayer from 'mineflayer';
// @ts-ignore
import { mineflayer as mineflayerViewer } from 'prismarine-viewer';
// @ts-ignore
import mcData from 'minecraft-data';

// Use a well-tested version for stability
const VERSION = '1.21.4';
// Tested versions: 1.8.8 - 1.21.4 (see flying-squid/src/lib/version.js)
const data = mcData(VERSION);

export interface SimulationOptions {
  /** Bot spawn position */
  botPosition?: Vec3;
  /** Items to give the bot (creative mode inventory set) */
  botInventory?: Array<{ name: string; count: number; slot?: number }>;
  /** Game mode: 'survival' or 'creative' */
  gameMode?: 'survival' | 'creative';
  /** Server port (default: 25599 to avoid conflicts) */
  port?: number;
  /** Viewer port (default: 3000) */
  viewerPort?: number;
  /** Enable prismarine-viewer (default: true) */
  enableViewer?: boolean;
  /** View distance in chunks (default: 4) */
  viewDistance?: number;
  /** First-person view (default: false = bird's eye) */
  firstPerson?: boolean;
  /** Auto-open browser (default: true) */
  openBrowser?: boolean;
}

export class LiveSimulationServer {
  private server: any = null;
  private bot: Bot | null = null;
  private viewer: any = null;
  private mockWorld: MockWorld | null = null;
  private options: SimulationOptions = {};

  /**
   * Start the simulation with a custom world.
   */
  async start(world: MockWorld, options: SimulationOptions = {}): Promise<Bot> {
    this.mockWorld = world;
    this.options = {
      botPosition: new Vec3(0, 65, 0),
      botInventory: [],
      gameMode: 'survival',
      port: 25599,
      viewerPort: 3000,
      enableViewer: true,
      viewDistance: 4,
      firstPerson: false,
      openBrowser: true,
      ...options,
    };

    console.log('[LiveSim] Starting flying-squid server...');
    await this.startServer();

    console.log('[LiveSim] Syncing world blocks...');
    await this.syncWorldBlocks();

    console.log('[LiveSim] Connecting bot...');
    await this.connectBot();

    if (this.options.enableViewer) {
      console.log('[LiveSim] Starting viewer...');
      await this.startViewer();
    }

    console.log('[LiveSim] Setting up bot state...');
    await this.setupBotState();

    console.log('[LiveSim] Ready!');
    return this.bot!;
  }

  /**
   * Get the connected bot instance.
   */
  getBot(): Bot {
    if (!this.bot) throw new Error('Simulation not started');
    return this.bot;
  }

  /**
   * Get the flying-squid server instance.
   */
  getServer(): any {
    return this.server;
  }

  /**
   * Update the world by setting a block (syncs to server).
   */
  async setBlock(pos: Vec3, blockName: string): Promise<void> {
    if (!this.server || !this.mockWorld) return;

    this.mockWorld.setBlock(pos, blockName);
    await this.setServerBlock(pos, blockName);
  }

  /**
   * Stop the simulation and clean up.
   */
  async stop(): Promise<void> {
    console.log('[LiveSim] Stopping...');

    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }

    if (this.server) {
      // flying-squid doesn't have a clean shutdown, so we just null it
      // The process will clean up on exit
      this.server = null;
    }

    this.viewer = null;
    this.mockWorld = null;

    console.log('[LiveSim] Stopped');
  }

  // --- Private methods ---

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = flyingSquid.createMCServer({
          'online-mode': false,
          'port': this.options.port,
          'motd': 'LiveSimulation Test Server',
          'max-players': 2,
          'version': VERSION,
          'view-distance': this.options.viewDistance,
          'gameMode': this.options.gameMode === 'creative' ? 1 : 0,
          'difficulty': 0, // Peaceful
          'worldFolder': undefined, // Don't save
          'generation': {
            name: 'superflat',
            options: {
              version: VERSION,
            },
          },
          'logging': true, // Enable to see server logs
          'everybody-op': true,
          'plugins': {},
          'player-list-text': {
            header: { text: 'Simulation' },
            footer: { text: '' },
          },
          'kickTimeout': 10000,
          'max-entities': 100,
          'modpe': false,
        });

        this.server.on('listening', () => {
          console.log(`[LiveSim] Server listening on port ${this.options.port}`);
          resolve();
        });

        this.server.on('error', (err: Error) => {
          console.error('[LiveSim] Server error:', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private async syncWorldBlocks(): Promise<void> {
    if (!this.mockWorld || !this.server) return;

    const blocks = this.mockWorld.getAllBlocks();
    console.log(`[LiveSim] Syncing ${blocks.length} blocks...`);

    // Wait for world to be ready
    await this.delay(500);

    let synced = 0;
    for (const block of blocks) {
      if (block.name === 'air') continue; // Skip air blocks

      try {
        await this.setServerBlock(block.position, block.name);
        synced++;
      } catch (err) {
        console.warn(`[LiveSim] Failed to set block at ${block.position}: ${err}`);
      }
    }

    console.log(`[LiveSim] Synced ${synced} blocks`);
  }

  private async setServerBlock(pos: Vec3, blockName: string): Promise<void> {
    if (!this.server) return;

    const blockData = data.blocksByName[blockName];
    if (!blockData) {
      console.warn(`[LiveSim] Unknown block: ${blockName}`);
      return;
    }

    // flying-squid's setBlock takes (world, position, blockType, blockData)
    const world = this.server.overworld;
    if (world && typeof this.server.setBlock === 'function') {
      this.server.setBlock(world, pos, blockData.id, 0);
    }
  }

  private async connectBot(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.bot = mineflayer.createBot({
        host: 'localhost',
        port: this.options.port,
        username: 'SimBot',
        version: VERSION,
        auth: 'offline',
      });

      this.bot.once('spawn', () => {
        console.log('[LiveSim] Bot spawned');
        resolve();
      });

      this.bot.once('error', (err: Error) => {
        console.error('[LiveSim] Bot error:', err);
        reject(err);
      });

      this.bot.once('kicked', (reason: string) => {
        console.error('[LiveSim] Bot kicked:', reason);
        reject(new Error(`Bot kicked: ${reason}`));
      });
    });
  }

  private async startViewer(): Promise<void> {
    if (!this.bot) return;

    mineflayerViewer(this.bot, {
      port: this.options.viewerPort,
      firstPerson: this.options.firstPerson,
    });

    console.log(`[LiveSim] Viewer at http://localhost:${this.options.viewerPort}`);

    if (this.options.openBrowser) {
      const { exec } = await import('child_process');
      const url = `http://localhost:${this.options.viewerPort}`;
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} "${url}"`);
    }
  }

  private async setupBotState(): Promise<void> {
    if (!this.bot) return;

    // Teleport to spawn position
    const pos = this.options.botPosition!;
    await this.teleportBot(pos);

    // Give inventory items (requires creative mode or op)
    if (this.options.botInventory && this.options.botInventory.length > 0) {
      await this.giveItems(this.options.botInventory);
    }
  }

  private async teleportBot(pos: Vec3): Promise<void> {
    if (!this.bot) return;

    // Use chat command (we have everybody-op enabled)
    this.bot.chat(`/tp ${pos.x} ${pos.y} ${pos.z}`);
    await this.delay(100);
  }

  private async giveItems(items: Array<{ name: string; count: number; slot?: number }>): Promise<void> {
    if (!this.bot) return;

    for (const item of items) {
      // Use /give command
      this.bot.chat(`/give SimBot ${item.name} ${item.count}`);
      await this.delay(50);
    }

    // Wait for inventory to update
    await this.delay(200);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function to create and start a simulation.
 */
export async function createSimulation(
  world: MockWorld,
  options?: SimulationOptions
): Promise<{ server: LiveSimulationServer; bot: Bot }> {
  const server = new LiveSimulationServer();
  const bot = await server.start(world, options);
  return { server, bot };
}
