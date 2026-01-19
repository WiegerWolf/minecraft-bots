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
  mocks/
    world-state/       # WorldState presets by role
    MockWorld.ts       # 3D block grid for world simulation
    BotMock.ts         # Mineflayer bot mock
    visualize-world.ts # Browser-based world visualization
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

## Visualization

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

### When to Use Visualization

1. **Debugging test failures**: See exactly what the test world looks like
2. **Designing new tests**: Verify block placement before writing assertions
3. **Understanding detection logic**: See why a tree might not be detected
4. **Explaining behavior**: Show others what a "stump field" vs "forest" means

### Adding Custom Scenarios

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
5. **Visualize when debugging** - `bun run visualize` to see what's happening
6. **Keep presets minimal** - only add blocks that matter for the test
