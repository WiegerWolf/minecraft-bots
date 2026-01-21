/**
 * PaperSimulationServer - Run bot logic against a real Paper Minecraft server
 * with custom world definitions.
 *
 * This provides accurate Minecraft physics for testing bot behavior.
 *
 * Prerequisites:
 *   - Paper server running on port 25566 with RCON enabled
 *   - Start with: cd server && ./start.sh
 *
 * Usage:
 * ```typescript
 * const sim = new PaperSimulationServer();
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
 * });
 *
 * // Access the real bot
 * const bot = sim.getBot();
 * ```
 */

import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { MockWorld } from '../mocks/MockWorld';
import { spawn, type Subprocess } from 'bun';
import { Rcon } from 'rcon-client';
import path from 'path';

// @ts-ignore
import mineflayer from 'mineflayer';
// @ts-ignore
import { mineflayer as mineflayerViewer } from 'prismarine-viewer';

const VERSION = '1.21.4';
const SERVER_DIR = path.join(import.meta.dir, '../../server');
const INSTANCE_DIR = path.join(SERVER_DIR, 'instance');

export interface SimulationOptions {
  /** Skip the default bedrock/grass ground fill (for void world tests) */
  skipDefaultGround?: boolean;
  /** Bot spawn position */
  botPosition?: Vec3;
  /** Items to give the bot */
  botInventory?: Array<{ name: string; count: number }>;
  /** Game mode: 'survival' or 'creative' */
  gameMode?: 'survival' | 'creative';
  /** Server port (default: 25566) */
  serverPort?: number;
  /** RCON port (default: 25575) */
  rconPort?: number;
  /** RCON password (default: 'simulation') */
  rconPassword?: string;
  /** Viewer port (default: 3000) */
  viewerPort?: number;
  /** Enable prismarine-viewer (default: false) */
  enableViewer?: boolean;
  /** First-person view (default: false = bird's eye) */
  firstPerson?: boolean;
  /** Auto-open browser (default: false) */
  openBrowser?: boolean;
  /** Start server automatically (default: true) */
  autoStartServer?: boolean;
  /** Clear world before placing blocks (default: true) */
  clearWorld?: boolean;
  /** World clear radius (default: 50) */
  clearRadius?: number;
  /** Wait for a player to join before proceeding (default: true) */
  waitForPlayer?: boolean;
  /** Test name to display in chat (optional) */
  testName?: string;
}

// Track players we've already set up spectator view for (persists across test runs)
const spectatorSetupDone = new Set<string>();

export class PaperSimulationServer {
  private serverProcess: Subprocess | null = null;
  private rcon: Rcon | null = null;
  private bot: Bot | null = null;
  private mockWorld: MockWorld | null = null;
  private options!: Required<SimulationOptions>;
  private rconCommandQueue: Promise<void> = Promise.resolve();
  private rconThrottleMs = 5; // ms between commands to avoid overwhelming RCON

  private defaultOptions: Required<SimulationOptions> = {
    botPosition: new Vec3(0, 65, 0),
    botInventory: [],
    gameMode: 'survival',
    serverPort: 25566,
    rconPort: 25575,
    rconPassword: 'simulation',
    viewerPort: 3000,
    enableViewer: false,
    firstPerson: false,
    openBrowser: false,
    autoStartServer: true,
    clearWorld: true,
    clearRadius: 50,
    skipDefaultGround: false,
    waitForPlayer: true,
    testName: '',
  };

  /**
   * Start the simulation with a custom world.
   */
  async start(world: MockWorld, options: SimulationOptions = {}): Promise<Bot> {
    this.mockWorld = world;
    this.options = { ...this.defaultOptions, ...options };

    // Start server if needed
    if (this.options.autoStartServer) {
      console.log('[PaperSim] Starting Paper server...');
      await this.startServer();
    }

    // Connect RCON
    console.log('[PaperSim] Connecting to RCON...');
    await this.connectRcon();

    // Clear and build world
    if (this.options.clearWorld) {
      console.log('[PaperSim] Clearing world area...');
      await this.clearWorldArea();
    }

    console.log('[PaperSim] Building world from MockWorld...');
    await this.buildWorld();

    // Set up world environment (time, weather, gamerules)
    console.log('[PaperSim] Setting world environment...');
    await this.setupWorldEnvironment();

    // Connect bot
    console.log('[PaperSim] Connecting bot...');
    await this.connectBot();

    // Setup bot state
    console.log('[PaperSim] Setting up bot state...');
    await this.setupBotState();

    // Start viewer (if enabled)
    if (this.options.enableViewer) {
      console.log('[PaperSim] Starting viewer...');
      await this.startViewer();
    }

    // Wait for player to join before proceeding
    if (this.options.waitForPlayer) {
      await this.waitForPlayerJoin();
    }

    // Announce test name in chat if provided
    if (this.options.testName) {
      await this.rconCommand(`say §e§l[TEST] §r§f${this.options.testName}`);
    }

    console.log('[PaperSim] Ready!');
    return this.bot!;
  }

  /**
   * Wait for a real player (not a bot) to join the server.
   * Returns immediately if a player is already connected.
   * Sets player to spectator mode and teleports them above the test area.
   */
  async waitForPlayerJoin(): Promise<string> {
    let playerName: string | null = null;

    // First check if a player is already connected
    try {
      const result = await this.rconCommand('list');
      const playersMatch = result.match(/online: (.+)$/);
      if (playersMatch) {
        const players = playersMatch[1]!.split(', ').map(p => p.trim()).filter(p => p);
        const realPlayers = players.filter(p => p !== 'SimBot');
        if (realPlayers.length > 0) {
          console.log(`[PaperSim] Player already connected: ${realPlayers.join(', ')}`);
          playerName = realPlayers[0]!;
        }
      }
    } catch {
      // RCON error, continue to wait
    }

    if (!playerName) {
      console.log('[PaperSim] ════════════════════════════════════════════════════');
      console.log('[PaperSim] Waiting for player to join...');
      console.log('[PaperSim] Connect to: localhost:' + this.options.serverPort);
      console.log('[PaperSim] ════════════════════════════════════════════════════');

      playerName = await new Promise<string>((resolve) => {
        let resolved = false;

        const checkPlayers = async () => {
          if (resolved) return;
          try {
            const result = await this.rconCommand('list');
            const playersMatch = result.match(/online: (.+)$/);
            if (playersMatch) {
              const players = playersMatch[1]!.split(', ').map(p => p.trim()).filter(p => p);
              const realPlayers = players.filter(p => p !== 'SimBot');
              if (realPlayers.length > 0) {
                resolved = true;
                console.log(`[PaperSim] Player joined: ${realPlayers.join(', ')}`);
                resolve(realPlayers[0]!);
                return;
              }
            }
          } catch {
            // RCON error, keep waiting
          }
          if (!resolved) {
            setTimeout(checkPlayers, 1000);
          }
        };

        const onPlayerJoined = (player: any) => {
          if (resolved) return;
          if (player.username !== 'SimBot') {
            resolved = true;
            console.log(`[PaperSim] Player joined: ${player.username}`);
            this.bot?.off('playerJoined', onPlayerJoined);
            resolve(player.username);
          }
        };

        this.bot?.on('playerJoined', onPlayerJoined);
        checkPlayers();
      });
    }

    // Set up spectator view only on first join
    if (!spectatorSetupDone.has(playerName)) {
      await this.setupSpectatorView(playerName);
      spectatorSetupDone.add(playerName);
    } else {
      console.log(`[PaperSim] Player ${playerName} ready (spectator view already set)`);
    }
    return playerName;
  }

  /**
   * Set up spectator mode and teleport player above the test area.
   */
  private async setupSpectatorView(playerName: string): Promise<void> {
    console.log(`[PaperSim] Setting up spectator view for ${playerName}...`);

    // Set spectator mode
    await this.rconCommand(`gamemode spectator ${playerName}`);

    // Teleport to a position looking at world center (0, 64, 0)
    // Position: offset from center, lower than before, angled toward center
    const viewX = 35;
    const viewY = 75;
    const viewZ = 35;

    // Calculate yaw to look at origin (0, 64, 0)
    // yaw = atan2(dz, -dx) * 180/PI + 180 (Minecraft convention)
    const dx = 0 - viewX;
    const dz = 0 - viewZ;
    const yaw = Math.atan2(dz, -dx) * (180 / Math.PI) + 180;

    // Calculate pitch to look down at target (y=64)
    const dy = 64 - viewY;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const pitch = -Math.atan2(-dy, horizontalDist) * (180 / Math.PI);

    await this.rconCommand(`tp ${playerName} ${viewX} ${viewY} ${viewZ} ${yaw.toFixed(1)} ${pitch.toFixed(1)}`);

    await this.delay(200);
  }

  /**
   * Get the connected bot instance.
   */
  getBot(): Bot {
    if (!this.bot) throw new Error('Simulation not started');
    return this.bot;
  }

  /**
   * Execute an RCON command with throttling and auto-reconnect.
   */
  async rconCommand(command: string): Promise<string> {
    // Queue commands to prevent overwhelming RCON
    return new Promise((resolve, reject) => {
      this.rconCommandQueue = this.rconCommandQueue.then(async () => {
        try {
          // Check if connected, reconnect if needed
          if (!this.rcon) {
            await this.connectRcon();
          }

          const result = await this.rcon!.send(command);

          // Small delay to prevent overwhelming RCON
          await this.delay(this.rconThrottleMs);

          resolve(result);
        } catch (err) {
          // Try to reconnect once on connection errors
          const errorMsg = String(err);
          if (errorMsg.includes('Not connected') || errorMsg.includes('Connection closed')) {
            console.log('[PaperSim] RCON disconnected, reconnecting...');
            try {
              this.rcon = null;
              await this.connectRcon();
              const result = await this.rcon!.send(command);
              await this.delay(this.rconThrottleMs);
              resolve(result);
            } catch (retryErr) {
              reject(retryErr);
            }
          } else {
            reject(err);
          }
        }
      });
    });
  }

  /**
   * Set a block via RCON.
   */
  async setBlock(pos: Vec3, blockName: string, options?: { signText?: string }): Promise<void> {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);

    // Handle signs with text
    if (options?.signText && blockName.includes('sign')) {
      await this.placeSign(pos, blockName, options.signText);
      return;
    }

    await this.rconCommand(`setblock ${x} ${y} ${z} minecraft:${blockName} replace`);
  }

  /**
   * Place a sign with text.
   */
  private async placeSign(pos: Vec3, blockName: string, text: string): Promise<void> {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);

    // First place the sign block
    await this.rconCommand(`setblock ${x} ${y} ${z} minecraft:${blockName} replace`);

    // Split text into lines (max 4 lines for a sign)
    const lines = text.split('\n').slice(0, 4);
    while (lines.length < 4) lines.push('');

    // Set each line individually using /data modify (most reliable)
    for (let i = 0; i < 4; i++) {
      const line = lines[i] || '';
      if (line) {
        // Escape for JSON string
        const escaped = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await this.rconCommand(
          `data modify block ${x} ${y} ${z} front_text.messages[${i}] set value '{"text":"${escaped}"}'`
        );
      }
    }
  }

  /**
   * Fill a region via RCON.
   */
  async fill(from: Vec3, to: Vec3, blockName: string): Promise<void> {
    const cmd = `fill ${Math.floor(from.x)} ${Math.floor(from.y)} ${Math.floor(from.z)} ` +
                `${Math.floor(to.x)} ${Math.floor(to.y)} ${Math.floor(to.z)} ` +
                `minecraft:${blockName} replace`;
    await this.rconCommand(cmd);
  }

  /**
   * Stop the simulation and clean up.
   * By default keeps the server running for faster subsequent tests.
   */
  async stop(options?: { killServer?: boolean }): Promise<void> {
    console.log('[PaperSim] Stopping...');

    // Wait for any pending RCON commands to complete
    try {
      await this.rconCommandQueue;
    } catch {
      // Ignore errors from pending commands
    }

    // Reset the command queue
    this.rconCommandQueue = Promise.resolve();

    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }

    if (this.rcon) {
      try {
        await this.rcon.end();
      } catch {
        // Ignore errors when closing RCON
      }
      this.rcon = null;
    }

    // Only kill server if explicitly requested
    if (options?.killServer && this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    this.mockWorld = null;
    console.log('[PaperSim] Stopped');
  }

  // --- Private methods ---

  private async startServer(): Promise<void> {
    // Check if server is already running
    try {
      const testRcon = new Rcon({
        host: 'localhost',
        port: this.options.rconPort,
        password: this.options.rconPassword,
      });
      await testRcon.connect();
      await testRcon.end();
      console.log('[PaperSim] Server already running');
      return;
    } catch {
      // Server not running, start it
    }

    // Run setup if instance doesn't exist
    const paperJar = path.join(INSTANCE_DIR, 'paper.jar');
    const fs = await import('fs');
    if (!fs.existsSync(paperJar)) {
      console.log('[PaperSim] Running setup.sh to download Paper...');
      const setupProc = spawn({
        cmd: ['./setup.sh'],
        cwd: SERVER_DIR,
        stdout: 'inherit',
        stderr: 'inherit',
      });
      await setupProc.exited;
    }

    console.log('[PaperSim] Starting server process...');
    this.serverProcess = spawn({
      cmd: ['java', '-Xms512M', '-Xmx1G', '-jar', 'paper.jar', '--nogui'],
      cwd: INSTANCE_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Wait for server to be ready (look for "Done" in output)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timeout')), 120000);

      const checkOutput = async () => {
        const stdout = this.serverProcess!.stdout;
        if (!stdout || typeof stdout === 'number') {
          reject(new Error('Server stdout not available'));
          return;
        }
        const reader = stdout.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          process.stdout.write(text); // Show server output

          if (text.includes('Done') && text.includes('For help')) {
            clearTimeout(timeout);
            reader.releaseLock();
            // Give it a moment to fully initialize
            await this.delay(1000);
            resolve();
            return;
          }
        }
      };

      checkOutput().catch(reject);
    });
  }

  private async connectRcon(): Promise<void> {
    // Clean up existing connection if any
    if (this.rcon) {
      try {
        await this.rcon.end();
      } catch {
        // Ignore errors when closing old connection
      }
      this.rcon = null;
    }

    let retries = 10;
    while (retries > 0) {
      try {
        this.rcon = new Rcon({
          host: 'localhost',
          port: this.options.rconPort,
          password: this.options.rconPassword,
        });
        await this.rcon.connect();
        console.log('[PaperSim] RCON connected');
        return;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        console.log(`[PaperSim] RCON connection failed, retrying... (${retries} left)`);
        await this.delay(2000);
      }
    }
  }

  private async clearWorldArea(): Promise<void> {
    const r = this.options.clearRadius;

    console.log(`[PaperSim] Clearing ${r * 2}x${r * 2} area centered at origin...`);

    // Max fill volume is 32768 blocks
    // With y range of 20 blocks: chunkSize^2 * 20 <= 32768 → chunkSize <= 40
    // Use 32 for safety
    const chunkSize = 32;
    const yRanges = [[60, 79], [80, 100]]; // Split Y to stay under block limit

    for (const [y1, y2] of yRanges) {
      for (let x = -r; x < r; x += chunkSize) {
        for (let z = -r; z < r; z += chunkSize) {
          const x1 = x;
          const z1 = z;
          const x2 = Math.min(x + chunkSize - 1, r - 1);
          const z2 = Math.min(z + chunkSize - 1, r - 1);

          await this.rconCommand(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:air replace`);
        }
      }
    }

    // Set bedrock floor at y=62 and grass at y=63 (common base for most test worlds)
    // Skip this for void world tests (obstacle courses, etc.)
    if (!this.options.skipDefaultGround) {
      for (let x = -r; x < r; x += chunkSize) {
        for (let z = -r; z < r; z += chunkSize) {
          const x1 = x;
          const z1 = z;
          const x2 = Math.min(x + chunkSize - 1, r - 1);
          const z2 = Math.min(z + chunkSize - 1, r - 1);

          await this.rconCommand(`fill ${x1} 62 ${z1} ${x2} 62 ${z2} minecraft:bedrock replace`);
          await this.rconCommand(`fill ${x1} 63 ${z1} ${x2} 63 ${z2} minecraft:grass_block replace`);
        }
      }
    }

    // Kill any dropped items from previous tests
    await this.rconCommand('kill @e[type=item]');
  }

  private async buildWorld(): Promise<void> {
    if (!this.mockWorld || !this.rcon) return;

    const blocks = this.mockWorld.getAllBlocks();
    // Skip grass_block at y=63 (already placed by clearWorldArea)
    // But DO place air blocks - they can be used to clear the default grass
    const blocksToPlace = blocks.filter(b => {
      if (b.name === 'grass_block' && b.position.y === 63) return false;
      return true;
    });
    console.log(`[PaperSim] Placing ${blocksToPlace.length} blocks...`);

    // Place blocks individually to preserve metadata (like signText)
    let placed = 0;
    for (const block of blocksToPlace) {
      try {
        await this.setBlock(block.position, block.name, { signText: block.signText });
        placed++;

        // Progress update every 100 blocks
        if (placed % 100 === 0) {
          console.log(`[PaperSim] Placed ${placed}/${blocksToPlace.length} blocks...`);
        }
      } catch (err) {
        console.warn(`[PaperSim] Failed to place ${block.name} at ${block.position}: ${err}`);
      }
    }

    console.log(`[PaperSim] Placed ${placed} blocks`);
  }

  /**
   * Set up world environment for consistent testing conditions.
   * - Stops daylight cycle at noon
   * - Clears weather and stops weather cycle
   */
  private async setupWorldEnvironment(): Promise<void> {
    if (!this.rcon) return;

    // Set time to noon and stop daylight cycle
    await this.rconCommand('time set noon');
    await this.rconCommand('gamerule doDaylightCycle false');

    // Clear weather and stop weather cycle
    await this.rconCommand('weather clear');
    await this.rconCommand('gamerule doWeatherCycle false');

    // Disable other annoyances for testing
    await this.rconCommand('gamerule doMobSpawning false');
    await this.rconCommand('gamerule doFireTick false');
    await this.rconCommand('gamerule mobGriefing false');
    await this.rconCommand('gamerule announceAdvancements false');
  }

  private async connectBot(): Promise<void> {
    // Kick any existing SimBot first to prevent duplicate_login errors
    try {
      await this.rconCommand('kick SimBot');
      await this.delay(500); // Wait for server to process the kick
    } catch {
      // Ignore errors if SimBot wasn't online
    }

    return new Promise((resolve, reject) => {
      this.bot = mineflayer.createBot({
        host: 'localhost',
        port: this.options.serverPort,
        username: 'SimBot',
        version: VERSION,
        auth: 'offline',
      });

      this.bot.once('spawn', () => {
        console.log('[PaperSim] Bot spawned');
        resolve();
      });

      this.bot.once('error', (err: Error) => {
        console.error('[PaperSim] Bot error:', err);
        reject(err);
      });

      this.bot.once('kicked', (reason: string) => {
        console.error('[PaperSim] Bot kicked:', reason);
        reject(new Error(`Bot kicked: ${reason}`));
      });
    });
  }

  private async setupBotState(): Promise<void> {
    if (!this.bot || !this.rcon) return;

    const pos = this.options.botPosition;

    // Clear any existing inventory (important between tests!)
    await this.rconCommand('clear SimBot');

    // Teleport bot
    await this.rconCommand(`tp SimBot ${pos.x} ${pos.y} ${pos.z}`);

    // Set game mode
    await this.rconCommand(`gamemode ${this.options.gameMode} SimBot`);

    // Give items
    for (const item of this.options.botInventory) {
      await this.rconCommand(`give SimBot minecraft:${item.name} ${item.count}`);
    }

    // Op the bot for any needed permissions
    await this.rconCommand('op SimBot');

    // Set up auto-op for any player who joins (test server convenience)
    this.setupAutoOp();

    await this.delay(500);
  }

  /**
   * Automatically op any player who joins the server.
   * This makes it easy to use admin commands when testing.
   */
  private setupAutoOp(): void {
    if (!this.bot) return;

    // Listen for player join messages and op them
    this.bot.on('message', async (message) => {
      const text = message.toString();
      // Match "PlayerName joined the game"
      const joinMatch = text.match(/^(\w+) joined the game$/);
      if (joinMatch) {
        const playerName = joinMatch[1];
        if (playerName !== 'SimBot') {
          console.log(`[PaperSim] Auto-opping player: ${playerName}`);
          try {
            await this.rconCommand(`op ${playerName}`);
          } catch (err) {
            // Ignore errors (player might have left)
          }
        }
      }
    });
  }

  /**
   * Op a player by username.
   */
  async opPlayer(username: string): Promise<void> {
    await this.rconCommand(`op ${username}`);
  }

  /**
   * Deop a player by username.
   */
  async deopPlayer(username: string): Promise<void> {
    await this.rconCommand(`deop ${username}`);
  }

  private async startViewer(): Promise<void> {
    if (!this.bot) return;

    mineflayerViewer(this.bot, {
      port: this.options.viewerPort,
      firstPerson: this.options.firstPerson,
    });

    console.log(`[PaperSim] Viewer at http://localhost:${this.options.viewerPort}`);

    if (this.options.openBrowser) {
      const { exec } = await import('child_process');
      const url = `http://localhost:${this.options.viewerPort}`;
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} "${url}"`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function to create and start a simulation.
 */
export async function createPaperSimulation(
  world: MockWorld,
  options?: SimulationOptions
): Promise<{ server: PaperSimulationServer; bot: Bot }> {
  const server = new PaperSimulationServer();
  const bot = await server.start(world, options);
  return { server, bot };
}
