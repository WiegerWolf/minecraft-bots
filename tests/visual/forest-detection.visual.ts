/**
 * Visual Test: Forest Detection
 *
 * Watch the lumberjack's forest detection algorithm step by step.
 *
 * Usage:
 *   bun run tests/visual/forest-detection.visual.ts
 */

import { Vec3 } from 'vec3';
import { getVisualTestServer } from '../mocks/VisualTestServer';
import { createBotMock } from '../mocks/BotMock';
import {
  createForestWorld,
  createStumpFieldWorld,
  createMixedWorld,
} from '../mocks/MockWorld';
import {
  createLumberjackBlackboard,
  updateLumberjackBlackboard,
} from '../../src/roles/lumberjack/LumberjackBlackboard';

async function main() {
  const server = getVisualTestServer();

  // Test 1: Forest World - Should detect forest
  {
    const world = createForestWorld();
    await server.start(world, 'Forest Detection - Forest World', {
      center: new Vec3(10, 75, 10),
    });

    await server.step('Created a forest world with 5 oak trees');

    const botPos = new Vec3(10, 64, 10);
    const bot = createBotMock({ world, position: botPos });
    await server.mark(botPos, 'Bot Position', 'cyan');

    await server.step('Bot spawned at (10, 64, 10). Creating blackboard...');

    const bb = createLumberjackBlackboard();
    bb.hasStudiedSigns = true;

    await server.step('Running updateLumberjackBlackboard()...');

    await updateLumberjackBlackboard(bot, bb);

    await server.step(`Blackboard updated! Found ${bb.nearbyLogs.length} nearby logs`);

    await server.inspect('nearbyLogs count', bb.nearbyLogs.length);
    for (const log of bb.nearbyLogs.slice(0, 10)) {
      await server.mark(log.position, 'Log', 'orange');
    }

    await server.step(`Found ${bb.nearbyTrees.length} nearby trees (logs with valid base)`);

    await server.step(`Found ${bb.forestTrees.length} FOREST trees (clustered trees with leaves)`);

    await server.clearMarkers();
    for (const tree of bb.forestTrees) {
      await server.mark(tree.position, 'Forest Tree', 'green');
    }
    await server.mark(botPos, 'Bot', 'cyan');

    await server.inspect('hasKnownForest', bb.hasKnownForest);
    await server.assert(bb.hasKnownForest === true, 'hasKnownForest should be true');
    await server.assert(bb.forestTrees.length >= 3, 'Should find at least 3 forest trees');

    await server.end('Forest Detection PASSED - Bot correctly identified the forest!');
  }

  // Test 2: Stump Field - Should NOT detect forest
  {
    const world = createStumpFieldWorld();
    await server.start(world, 'Forest Detection - Stump Field', {
      center: new Vec3(10, 75, 10),
    });

    await server.step('Created a stump field (logs without leaves)');

    const botPos = new Vec3(10, 64, 10);
    const bot = createBotMock({ world, position: botPos });
    await server.mark(botPos, 'Bot Position', 'cyan');

    await server.step('Bot spawned. Running detection...');

    const bb = createLumberjackBlackboard();
    bb.hasStudiedSigns = true;
    await updateLumberjackBlackboard(bot, bb);

    await server.step(`Found ${bb.nearbyLogs.length} nearby logs (stumps)`);

    for (const log of bb.nearbyLogs) {
      await server.mark(log.position, 'Stump', 'red');
    }

    await server.inspect('nearbyTrees', bb.nearbyTrees.length);
    await server.inspect('forestTrees', bb.forestTrees.length);
    await server.inspect('hasKnownForest', bb.hasKnownForest);

    await server.assert(bb.forestTrees.length === 0, 'Should find 0 forest trees');
    await server.assert(bb.hasKnownForest === false, 'hasKnownForest should be false');

    await server.end('Stump Field PASSED - Bot correctly ignored stumps!');
  }

  // Test 3: Mixed World - Stumps nearby, forest far
  {
    const world = createMixedWorld();
    await server.start(world, 'Forest Detection - Mixed World', {
      center: new Vec3(15, 75, 0),
    });

    await server.step('Created mixed world: stumps nearby (0-5), forest far (25-35)');

    await server.step('Testing with default search radius (32 blocks)...');

    const botPos = new Vec3(1, 64, 1);
    const bot = createBotMock({ world, position: botPos });
    await server.mark(botPos, 'Bot (32 block radius)', 'cyan');

    const bb1 = createLumberjackBlackboard();
    bb1.hasStudiedSigns = true;
    await updateLumberjackBlackboard(bot, bb1);

    await server.step(`Default radius: Found ${bb1.nearbyLogs.length} logs, ${bb1.forestTrees.length} forest trees`);
    await server.inspect('hasKnownForest', bb1.hasKnownForest);

    await server.step('Now testing with village center (50 block radius)...');

    await server.clearMarkers();
    await server.mark(botPos, 'Bot (50 block radius)', 'lime');

    const bb2 = createLumberjackBlackboard();
    bb2.hasStudiedSigns = true;
    bb2.villageCenter = new Vec3(0, 64, 0);
    await updateLumberjackBlackboard(bot, bb2);

    await server.step(`Extended radius: Found ${bb2.nearbyLogs.length} logs, ${bb2.forestTrees.length} forest trees`);

    for (const tree of bb2.forestTrees) {
      await server.mark(tree.position, 'Forest Tree', 'green');
    }

    await server.inspect('hasKnownForest', bb2.hasKnownForest);
    await server.assert(bb2.forestTrees.length > 0, 'Should find forest with extended radius');

    await server.end('Mixed World PASSED - Radius affects detection correctly!');
  }

  console.log('\n🎉 All visual tests completed!\n');
  await server.shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
