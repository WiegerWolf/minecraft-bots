/**
 * Visual Test: Forest Detection
 *
 * Watch the lumberjack's forest detection algorithm step by step.
 *
 * Usage:
 *   bun run tests/visual/forest-detection.visual.ts
 *   bun run tests/visual/forest-detection.visual.ts --auto  (auto-advance)
 */

import { Vec3 } from 'vec3';
import { VisualTestHarness } from '../mocks/VisualTestHarness';
import { createBotMock } from '../mocks/BotMock';
import {
  MockWorld,
  createForestWorld,
  createStumpFieldWorld,
  createMixedWorld,
  createOakTree,
  createStump,
} from '../mocks/MockWorld';
import {
  createLumberjackBlackboard,
  updateLumberjackBlackboard,
} from '../../src/roles/lumberjack/LumberjackBlackboard';

async function main() {
  const autoAdvance = process.argv.includes('--auto');
  const harness = new VisualTestHarness();

  // Test 1: Forest World - Should detect forest
  {
    const world = createForestWorld();
    await harness.start(world, 'Forest Detection - Forest World', {
      autoAdvance,
      delay: 1500,
      center: new Vec3(0, 75, 0),
    });

    await harness.step('Created a forest world with 5 oak trees');

    const botPos = new Vec3(0, 64, 0);
    const bot = createBotMock({ world, position: botPos });
    await harness.mark(botPos, 'Bot Position', 'cyan');

    await harness.step('Bot spawned at origin. Creating blackboard...');

    const bb = createLumberjackBlackboard();
    bb.hasStudiedSigns = true; // Skip sign requirement

    await harness.step('Running updateLumberjackBlackboard()...');

    await updateLumberjackBlackboard(bot, bb);

    await harness.step(`Blackboard updated! Found ${bb.nearbyLogs.length} nearby logs`);

    // Mark all found logs
    await harness.inspect('nearbyLogs count', bb.nearbyLogs.length);
    for (const log of bb.nearbyLogs.slice(0, 10)) {
      await harness.mark(log, 'Log', 'orange');
    }

    await harness.step(`Found ${bb.nearbyTrees.length} nearby trees (logs with valid base)`);

    await harness.step(`Found ${bb.forestTrees.length} FOREST trees (clustered trees with leaves)`);

    // Mark forest trees in green
    await harness.clearMarkers();
    for (const tree of bb.forestTrees) {
      await harness.mark(tree.position, 'Forest Tree', 'green');
    }
    await harness.mark(botPos, 'Bot', 'cyan');

    await harness.inspect('hasKnownForest', bb.hasKnownForest);
    await harness.assert(bb.hasKnownForest === true, 'hasKnownForest should be true');
    await harness.assert(bb.forestTrees.length >= 3, 'Should find at least 3 forest trees');

    await harness.end('Forest Detection PASSED - Bot correctly identified the forest!');
  }

  // Test 2: Stump Field - Should NOT detect forest
  {
    const world = createStumpFieldWorld();
    await harness.start(world, 'Forest Detection - Stump Field', {
      autoAdvance,
      delay: 1500,
      center: new Vec3(0, 75, 0),
    });

    await harness.step('Created a stump field (logs without leaves)');

    const botPos = new Vec3(0, 64, 0);
    const bot = createBotMock({ world, position: botPos });
    await harness.mark(botPos, 'Bot Position', 'cyan');

    await harness.step('Bot spawned. Running detection...');

    const bb = createLumberjackBlackboard();
    bb.hasStudiedSigns = true;
    await updateLumberjackBlackboard(bot, bb);

    await harness.step(`Found ${bb.nearbyLogs.length} nearby logs (stumps)`);

    // Mark stumps in red
    for (const log of bb.nearbyLogs) {
      await harness.mark(log, 'Stump', 'red');
    }

    await harness.inspect('nearbyTrees', bb.nearbyTrees.length);
    await harness.inspect('forestTrees', bb.forestTrees.length);
    await harness.inspect('hasKnownForest', bb.hasKnownForest);

    await harness.assert(bb.forestTrees.length === 0, 'Should find 0 forest trees');
    await harness.assert(bb.hasKnownForest === false, 'hasKnownForest should be false');

    await harness.end('Stump Field PASSED - Bot correctly ignored stumps!');
  }

  // Test 3: Mixed World - Stumps nearby, forest far
  {
    const world = createMixedWorld();
    await harness.start(world, 'Forest Detection - Mixed World', {
      autoAdvance,
      delay: 1500,
      center: new Vec3(15, 75, 0),
    });

    await harness.step('Created mixed world: stumps nearby (0-5), forest far (25-35)');

    // Show the layout
    await harness.highlightRegion(new Vec3(-5, 64, -5), new Vec3(10, 64, 10), 'Stump Area', 'red');
    await harness.highlightRegion(new Vec3(23, 64, -5), new Vec3(35, 64, 12), 'Forest Area', 'green');

    await harness.step('Red = stump area, Green = forest area');

    // Test with default radius (32 blocks)
    const botPos = new Vec3(0, 64, 0);
    const bot = createBotMock({ world, position: botPos });
    await harness.mark(botPos, 'Bot (32 block radius)', 'cyan');

    const bb1 = createLumberjackBlackboard();
    bb1.hasStudiedSigns = true;
    await updateLumberjackBlackboard(bot, bb1);

    await harness.step(`Default radius (32): Found ${bb1.nearbyLogs.length} logs, ${bb1.forestTrees.length} forest trees`);
    await harness.inspect('hasKnownForest', bb1.hasKnownForest);

    // Test with village center (50 block radius)
    await harness.step('Now testing with village center (50 block radius)...');

    await harness.clearMarkers();
    await harness.mark(botPos, 'Bot (50 block radius)', 'lime');

    const bb2 = createLumberjackBlackboard();
    bb2.hasStudiedSigns = true;
    bb2.villageCenter = new Vec3(0, 64, 0); // Enables larger radius
    await updateLumberjackBlackboard(bot, bb2);

    await harness.step(`Extended radius (50): Found ${bb2.nearbyLogs.length} logs, ${bb2.forestTrees.length} forest trees`);

    // Mark found forest trees
    for (const tree of bb2.forestTrees) {
      await harness.mark(tree.position, 'Forest Tree', 'green');
    }

    await harness.inspect('hasKnownForest', bb2.hasKnownForest);
    await harness.assert(bb2.forestTrees.length > 0, 'Should find forest with extended radius');

    await harness.end('Mixed World PASSED - Radius affects detection correctly!');
  }

  console.log('\n🎉 All visual tests completed!\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
