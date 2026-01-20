# Testing Infrastructure

This document covers the testing approach, MockWorld system, and visualization tools for debugging bot behavior.

## Philosophy

**Tests verify behavioral specifications, not implementation details.**

Each test file focuses on one behavioral aspect (startup, trading, inventory, etc.) and test names start with `SPEC:` to indicate they define expected behavior. Tests use WorldState presets and MockWorld to create deterministic scenarios without needing a running Minecraft server.

## Test Organization

```
tests/
  scenarios/           # Behavioral specs by role
    farmer/
      startup.test.ts      # Boot sequence, sign study
      trading.test.ts      # Trade completion, offers
      core-work.test.ts    # Harvesting, planting, tilling
      ...
    lumberjack/
      tree-detection.test.ts   # Tree vs stump detection
      blackboard-world.test.ts # Full blackboard integration
      ...
    landscaper/
      ...
  simulation/          # Integration tests with real Paper server
    PaperSimulationServer.ts  # Server management, world sync
    SimulationTest.ts         # Test framework with assertions
    ScenarioBuilder.ts        # Fluent API for building test worlds
    lumberjack.test.sim.ts    # Lumberjack integration tests
    farmer.test.sim.ts        # Farmer integration tests
    landscaper.test.sim.ts    # Landscaper integration tests
    multi-bot.test.sim.ts     # Multi-bot coordination tests
    run-all-tests.ts          # Run all simulation test suites
    run-lumberjack-paper.sim.ts # Interactive simulation runner
  mocks/
    world-state/       # WorldState presets by role
    MockWorld.ts       # 3D block grid for world simulation
    BotMock.ts         # Mineflayer bot mock
    VisualTestServer.ts # Browser-based visual test harness
    visualize-world.ts  # Static world visualization
  visual/
    ui/index.html      # Browser UI for visual tests
    run-visual.ts      # Visual test runner
    *.visual.ts        # Visual test files
```

## MockWorld System

MockWorld provides a deterministic 3D block grid that simulates the Minecraft world without needing a server. It integrates with BotMock to make `bot.blockAt()` and `bot.findBlocks()` work in tests.

### Why MockWorld?

Before MockWorld, debugging tree detection required:
1. Starting a Minecraft server
2. Running the bot
3. Teleporting to various locations
4. Adding debug logging
5. Checking logs to understand what the bot "saw"

With MockWorld:
1. Create a preset world in code
2. Run tests instantly
3. Get deterministic, reproducible results
4. Visualize the exact world the test uses

### Basic Usage

```typescript
import { MockWorld, createOakTree, createStump } from '../../mocks/MockWorld';
import { createBotMock } from '../../mocks/BotMock';

const world = new MockWorld();

// Set individual blocks
world.setBlock(new Vec3(0, 63, 0), 'grass_block');
world.setBlock(new Vec3(0, 64, 0), 'oak_log');

// Fill regions
world.fill(new Vec3(-10, 63, -10), new Vec3(10, 63, 10), 'grass_block');

// Use tree builders
createOakTree(world, new Vec3(0, 64, 0), 5);  // 5-block trunk
createStump(world, new Vec3(5, 64, 0));        // Single log, no leaves

// Create a bot that uses this world
const bot = createBotMock({
  world,
  position: new Vec3(0, 64, 0),
  inventory: [item('stone_axe', 1)],
});

// Now bot.blockAt() and bot.findBlocks() work with MockWorld
const block = bot.blockAt(new Vec3(0, 64, 0));
expect(block?.name).toBe('oak_log');
```

### Preset Worlds

Ready-to-use test scenarios:

| Function | Description | Use Case |
|----------|-------------|----------|
| `createForestWorld()` | 5 oak trees clustered together | Forest detection, clustering logic |
| `createStumpFieldWorld()` | 6 stumps (logs without leaves) | Stump vs tree differentiation |
| `createMixedWorld()` | Stumps nearby, forest at 25-35 blocks | Search radius testing |
| `createStructureWorld()` | Wooden building + 1 real tree | Structure avoidance |

### Tree Builders

```typescript
// Full tree with trunk and leaf canopy
createOakTree(world, basePos, trunkHeight);   // Default height: 5
createBirchTree(world, basePos, trunkHeight); // Default height: 7

// Stump (single log on grass, no leaves)
createStump(world, pos, logType);  // Default: 'oak_log'
```

### MockWorld Behavior

- **Unset positions return 'air'**: Like real Minecraft, empty space is air, not null
- **findBlocks() only searches set blocks**: Won't iterate the entire world
- **Positions are floored**: `Vec3(0.5, 64.9, 0.5)` → block at `(0, 64, 0)`

## Static Visualization

Visualize MockWorld presets in a browser using prismarine-viewer:

```bash
# Visualize preset worlds
bun run visualize forest       # 5 oak trees (default)
bun run visualize stump-field  # Only stumps
bun run visualize mixed        # Stumps nearby, forest far away
bun run visualize structure    # Wooden building + 1 real tree
bun run visualize custom       # Custom scenario (edit visualize-world.ts)
```

Then open http://localhost:3000 in your browser.

**Controls:**
- WASD - move
- Mouse - look around
- Space/Shift - up/down

## Visual Tests (Browser-Based)

Watch tests execute step-by-step in a browser UI with the 3D viewer, like Cypress/Playwright for Minecraft.

### Running Visual Tests

```bash
# List available visual tests
bun run test:visual

# Run a visual test (browser opens automatically)
bun run test:visual forest-detection

# Run all visual tests
bun run test:visual all
```

The browser opens automatically with a split-screen UI:
- **Left side**: 3D Minecraft world viewer (prismarine-viewer)
- **Right side**: Test controls, step info, and log output

### Browser Controls

| Control | Action |
|---------|--------|
| **Next** button or **Space** | Advance to next step |
| **Auto** button or **A** | Toggle auto-advance mode |

The UI shows:
- Current test name
- Step number and message
- Log of marks, inspections, and assertions
- Pass/fail indicators (✅/❌)

### Available Visual Tests

| Test | Description |
|------|-------------|
| `forest-detection` | Forest detection algorithm: forest world, stump field, mixed world |
| `tree-vs-stump` | Tree vs stump differentiation, leaf threshold demo |

### Writing Visual Tests

Visual tests use `VisualTestServer` which provides WebSocket communication with the browser UI:

```typescript
// tests/visual/my-test.visual.ts
import { Vec3 } from 'vec3';
import { getVisualTestServer } from '../mocks/VisualTestServer';
import { MockWorld, createOakTree } from '../mocks/MockWorld';

async function main() {
  const server = getVisualTestServer();

  const world = new MockWorld();
  world.fill(new Vec3(-10, 63, -10), new Vec3(10, 63, 10), 'grass_block');
  createOakTree(world, new Vec3(0, 64, 0), 5);

  await server.start(world, 'My Visual Test', {
    center: new Vec3(0, 70, 0),  // Camera position
  });

  await server.step('Created a tree at origin');
  await server.mark(new Vec3(0, 64, 0), 'Tree Base', 'green');

  // Run your test logic
  const result = someDetectionFunction(world);

  await server.inspect('Result', result);
  await server.assert(result.success, 'Detection should succeed');

  await server.end('Test passed!');
  await server.shutdown();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

### Server API

| Method | Description |
|--------|-------------|
| `start(world, name, opts)` | Start viewer + browser UI (auto-opens browser) |
| `step(message)` | Show step, wait for Next click or Space |
| `mark(pos, label, color)` | Add colored beacon above position |
| `markMany(positions, label, color)` | Mark multiple positions |
| `clearMarkers()` | Remove all markers |
| `inspect(label, value)` | Log value in browser UI |
| `assert(condition, message)` | Show pass/fail with icon |
| `end(message)` | Complete test, close viewer |
| `shutdown()` | Close UI server (call at end of all tests) |

**Marker colors:** `red`, `green`, `blue`, `yellow`, `lime`, `orange`, `magenta`, `cyan`, `white`, `black`

**Note:** Markers place a small beacon (colored blocks + glowstone) 3 blocks above the marked position, so they don't overwrite the blocks being marked.

### Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│  Visual Test    │◄──────────────────►│   Browser UI    │
│  (Bun process)  │                    │  (index.html)   │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │ prismarine-viewer                    │ iframe
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│  3D World       │◄───────────────────│  Viewer Frame   │
│  (port 3010+)   │                    │                 │
└─────────────────┘                    └─────────────────┘
```

- **UI Server** (port 3008): Serves the HTML UI and handles WebSocket
- **Viewer** (port 3010+): prismarine-viewer for 3D rendering (port increments per test)
- Tests run in single browser tab, viewer iframe updates between tests

### When to Use Static vs Visual

- **Static visualization** (`bun run visualize`): Quick look at preset worlds, designing test scenarios
- **Visual tests** (`bun run test:visual`): Step-by-step debugging, understanding algorithm flow, demos

## Simulation Tests (Real Physics)

Simulation tests run bot behavior against a **real Paper Minecraft server** with actual game physics. Unlike MockWorld tests which simulate block data, simulation tests verify the bot works correctly with real pathfinding, block breaking, item pickup, and inventory management.

### Why Simulation Tests?

MockWorld is great for unit testing detection algorithms, but some behaviors require real physics:
- Pathfinding actually moves the bot
- Block breaking drops real items
- Items despawn, gravity applies
- Timing and physics quirks match the real game

### Running Simulation Tests

```bash
# Run all simulation tests
bun run sim:test

# Run specific role tests
bun run sim:test:lumberjack   # Tree chopping, stump detection, drops
bun run sim:test:farmer       # Harvesting, planting, tilling, seed gathering
bun run sim:test:landscaper   # Terraforming, dirt gathering, hole filling
bun run sim:test:multibot     # Multi-bot coordination, chat, trading

# Run interactive simulation (watch bot in browser or Minecraft client)
bun run sim:lumberjack
```

The Paper server starts automatically if not running. A superflat world is used for consistent test isolation.

### Simulation Test Logging

All simulation tests write structured JSON logs to the `logs/` directory:

```
logs/
  test-2026-01-20_18-52-39/              # Single directory per test run
    all.log                               # Combined log from all tests
    lumberjack-chops-trees-in-a-forest.log
    lumberjack-ignores-stumps.log
    farmer-harvests-mature-wheat.log
    farmer-plants-seeds-on-farmland.log
    landscaper-collects-dropped-items.log
    ...
  latest -> test-2026-01-20_18-52-39/    # Symlink to most recent
```

**Key features:**
- **One directory per run**: Running `bun run sim:test` creates a single session directory for all test suites
- **Per-test log files**: Each test case gets its own log file (named from test name, kebab-cased)
- **Combined all.log**: Aggregates all test output for easy searching across tests
- **Session ID sharing**: Parent process generates session ID and passes to child processes via `SIM_TEST_SESSION_ID` env var

**Searching logs:**
```bash
# View combined log for latest run
cat logs/latest/all.log | jq .

# Find errors across all tests
cat logs/latest/all.log | jq 'select(.level >= 50)'

# Search specific test
cat logs/latest/farmer-harvests-mature-wheat.log | jq '.msg'

# Find goal selections
grep "Goal selected" logs/latest/all.log | jq '.goal, .utility'
```

### Available Simulation Test Suites

| Suite | Command | Tests |
|-------|---------|-------|
| Lumberjack | `sim:test:lumberjack` | Chops trees, ignores stumps, prefers forests, collects drops |
| Farmer | `sim:test:farmer` | Harvests wheat, plants seeds, tills ground, gathers seeds, deposits to chest |
| Landscaper | `sim:test:landscaper` | Collects drops, crafts tools, gathers dirt, terraforms, fills holes |
| Multi-Bot | `sim:test:multibot` | Village chat, trade protocol, shared chest exchange |

### Prerequisites

The simulation server is set up automatically on first run:
- Downloads Paper 1.21.4 to `server/instance/`
- Copies configs from `server/config/`
- Uses port 25566 (game) and 25575 (RCON)

You can also join with a real Minecraft client at `localhost:25566` to observe tests.

### Writing Simulation Tests

```typescript
import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from './SimulationTest';
import { MockWorld, createOakTree } from '../mocks/MockWorld';
import { LumberjackRole } from '../../src/roles/lumberjack/LumberjackRole';

async function testChopsTree() {
  const test = new SimulationTest('Lumberjack chops trees');

  // Create world (same MockWorld API - synced to real server via RCON)
  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
  createOakTree(world, new Vec3(10, 64, 10), 5);
  world.setBlock(new Vec3(0, 64, 0), 'oak_sign', { signText: 'VILLAGE CENTER' });

  // Setup: spawns bot, syncs world, clears inventory
  await test.setup(world, {
    botPosition: new Vec3(3, 65, 3),
    botInventory: [{ name: 'iron_axe', count: 1 }],
  });

  // Load plugins and start role
  test.bot.loadPlugin(pathfinderPlugin);
  await test.wait(2000, 'World loading');

  const role = new LumberjackRole();
  role.start(test.bot);

  // Wait for conditions with timeout
  await test.waitForInventory('oak_log', 1, {
    timeout: 60000,
    message: 'Bot should collect at least 1 oak log',
  });

  // Assertions
  test.assertGreater(test.botInventoryCount('oak_log'), 0, 'Has logs');

  role.stop(test.bot);
  return test.cleanup();
}

// Run test suite
async function main() {
  const { passed, failed } = await runSimulationTests([
    testChopsTree,
  ]);
  process.exit(failed > 0 ? 1 : 0);
}
```

### SimulationTest API

**Setup & Cleanup:**
| Method | Description |
|--------|-------------|
| `setup(world, options)` | Start server, sync world, spawn bot |
| `cleanup()` | Stop bot, return test results |

**Wait Helpers:**
| Method | Description |
|--------|-------------|
| `wait(ms, reason?)` | Simple delay |
| `waitUntil(condition, options)` | Wait for condition to be true |
| `waitForInventory(item, count, options)` | Wait for item count |
| `waitForPosition(pos, distance, options)` | Wait for bot near position |
| `waitForBlock(pos, block, options)` | Wait for block type |

**Assertions:**
| Method | Description |
|--------|-------------|
| `assert(condition, message)` | Basic assertion |
| `assertEqual(actual, expected, message)` | Equality check |
| `assertGreater(actual, expected, message)` | Greater than check |
| `assertNear(pos, distance, message)` | Bot position check |
| `assertInventory(item, minCount, message)` | Inventory check |
| `assertBlock(pos, block, message)` | Block type check |

**State Queries:**
| Method | Description |
|--------|-------------|
| `botInventoryCount(item)` | Count of item in inventory |
| `botDistanceTo(pos)` | Distance from bot to position |
| `botPosition()` | Current bot position |
| `blockAt(pos)` | Block name at position |
| `botHealth()` | Bot health |
| `botFood()` | Bot food level |

**Actions:**
| Method | Description |
|--------|-------------|
| `rcon(command)` | Execute RCON command |
| `teleportBot(pos)` | Teleport bot |
| `giveItem(item, count)` | Give item to bot |
| `setBlock(pos, block)` | Set block in world |
| `chat(message)` | Send chat as bot |

### World Isolation

Between tests, the simulation framework:
1. Clears a 100x100 area centered at origin (y=60-100)
2. Sets bedrock floor (y=62) and grass (y=63)
3. Kills all dropped items
4. Clears bot inventory

The server uses a superflat world (`level-type=minecraft:flat`) to prevent natural terrain interference.

### Interactive Simulation

For debugging, run an interactive simulation:

```bash
bun run sim:lumberjack
```

This opens:
- **Browser viewer** at http://localhost:3000 (prismarine-viewer)
- **Minecraft client** can connect to localhost:25566

The bot runs continuously until you press Ctrl+C. You're auto-opped when joining, so you can use `/gamemode`, `/tp`, etc.

### When to Use Simulation vs MockWorld

| Use Case | MockWorld | Simulation |
|----------|-----------|------------|
| Tree detection algorithm | ✅ Fast, deterministic | Overkill |
| Goal utility calculations | ✅ No physics needed | Overkill |
| Pathfinding behavior | ❌ No real movement | ✅ Real physics |
| Block breaking & drops | ❌ Simulated | ✅ Real items |
| Full role integration | ❌ Missing physics | ✅ End-to-end |
| CI/CD pipeline | ✅ No server needed | Requires server |

## Adding Custom Static Scenarios

Edit `tests/mocks/visualize-world.ts` and add a case:

```typescript
case 'my-scenario':
  const world = new MockWorld();
  world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');

  // Your custom setup
  createOakTree(world, new Vec3(0, 64, 0), 8);  // Tall tree
  // ...

  return world;
```

Then run: `bun run visualize my-scenario`

## Writing Tests with MockWorld

### Testing Tree Detection

```typescript
describe('SPEC: hasLeavesAttached correctly identifies trees vs stumps', () => {
  test('returns true for a standing tree with leaves', () => {
    const world = new MockWorld();
    createOakTree(world, new Vec3(0, 64, 0), 5);

    const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
    expect(hasLeaves).toBe(true);
  });

  test('returns false for a stump (log without leaves)', () => {
    const world = new MockWorld();
    createStump(world, new Vec3(0, 64, 0));

    const hasLeaves = hasLeavesAttached(world, new Vec3(0, 64, 0), OAK_LEAVES);
    expect(hasLeaves).toBe(false);
  });
});
```

### Testing Blackboard Updates

```typescript
test('bot in forest: hasKnownForest = true, forestTrees >= 3', async () => {
  const world = createForestWorld();
  const bot = createBotMock({
    world,
    position: new Vec3(0, 64, 0),
  });
  const bb = createLumberjackBlackboard();
  bb.hasStudiedSigns = true;  // Skip sign study requirement

  await updateLumberjackBlackboard(bot, bb);

  expect(bb.forestTrees.length).toBeGreaterThanOrEqual(3);
  expect(bb.hasKnownForest).toBe(true);
});
```

### Testing Search Radius

```typescript
test('with search radius 32: finds stumps but not distant trees', async () => {
  const world = createMixedWorld();  // Stumps at 0-5, trees at 25-35
  const bot = createBotMock({ world, position: new Vec3(0, 64, 0) });
  const bb = createLumberjackBlackboard();
  bb.hasStudiedSigns = true;
  // No village center = 32 block search radius

  await updateLumberjackBlackboard(bot, bb);

  expect(bb.nearbyLogs.length).toBeGreaterThan(0);  // Found stumps
  // Trees at 25-35 blocks, some might be in range depending on radius
});
```

## WorldState Presets

For GOAP planning tests, use WorldState presets instead of MockWorld:

```typescript
import { freshSpawnFarmerState, readyToHarvestState } from '../../mocks/world-state/farmer';

test('SPEC: StudySpawnSigns has highest utility at spawn', () => {
  const state = freshSpawnFarmerState();
  const utility = StudySpawnSigns.getUtility(state);
  expect(utility).toBeGreaterThan(100);
});
```

WorldState presets are faster for pure planning tests since they don't need 3D world simulation.

## Best Practices

1. **Use SPEC: prefix** for behavioral tests that define expected behavior
2. **One aspect per file** - keep tests focused (trading.test.ts, inventory.test.ts)
3. **Use MockWorld for world interaction** - when testing blockAt, findBlocks, detection
4. **Use WorldState presets for planning** - when testing goal utilities, action preconditions
5. **Visual tests for debugging** - `bun run test:visual` to step through algorithm behavior
6. **Static visualization for design** - `bun run visualize` when designing test scenarios
7. **Keep presets minimal** - only add blocks that matter for the test
8. **Spawn bot away from objects** - avoid placing bot at same position as trees/stumps
