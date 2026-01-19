/**
 * Visual Test: Tree vs Stump Detection
 *
 * Watch how the bot distinguishes between real trees and stumps.
 *
 * Usage:
 *   bun run test:visual tree-vs-stump
 */

import { Vec3 } from 'vec3';
import { getVisualTestServer } from '../mocks/VisualTestServer';
import { MockWorld, createOakTree, createStump } from '../mocks/MockWorld';

// Replicate the hasLeavesAttached logic for visualization
function hasLeavesAttached(
  world: MockWorld,
  logPos: Vec3,
  searchRadius: number = 5,
  minLeaves: number = 3
): { hasLeaves: boolean; leafCount: number; leafPositions: Vec3[] } {
  const validLeaves = ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves'];
  let leafCount = 0;
  const leafPositions: Vec3[] = [];

  for (let dy = 0; dy <= searchRadius + 3; dy++) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        const horizontalDist = Math.abs(dx) + Math.abs(dz);
        if (horizontalDist > searchRadius) continue;

        const checkPos = logPos.offset(dx, dy, dz);
        const block = world.blockAt(checkPos);

        if (block && validLeaves.includes(block.name)) {
          leafCount++;
          leafPositions.push(checkPos);
        }
      }
    }
  }

  return {
    hasLeaves: leafCount >= minLeaves,
    leafCount,
    leafPositions,
  };
}

async function main() {
  const server = getVisualTestServer();

  // Test 1: Single tree detection
  {
    const world = new MockWorld();
    world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');
    createOakTree(world, new Vec3(0, 64, 0), 5);

    await server.start(world, 'Tree Detection - Single Oak Tree', {
      center: new Vec3(0, 70, 5),
    });

    await server.step('Created a single oak tree (5 block trunk)');

    const baseLog = new Vec3(0, 64, 0);
    await server.mark(baseLog, 'Base Log', 'orange');

    await server.step('Checking for leaves attached to the base log...');

    const result = hasLeavesAttached(world, baseLog);

    await server.inspect('Leaf count', result.leafCount);
    await server.inspect('Has enough leaves (>=3)', result.hasLeaves);

    await server.step(`Found ${result.leafCount} leaves. Marking some...`);
    for (const leafPos of result.leafPositions.slice(0, 5)) {
      await server.mark(leafPos, 'Leaf', 'green');
    }

    await server.assert(result.hasLeaves, 'Tree should have leaves attached');
    await server.end('Tree Detection PASSED!');
  }

  // Test 2: Stump detection
  {
    const world = new MockWorld();
    world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');
    createStump(world, new Vec3(0, 64, 0));

    await server.start(world, 'Tree Detection - Stump (No Leaves)', {
      center: new Vec3(0, 70, 5),
    });

    await server.step('Created a stump - single log on grass, no leaves');

    const stumpPos = new Vec3(0, 64, 0);
    await server.mark(stumpPos, 'Stump', 'red');

    await server.step('Checking for leaves...');

    const result = hasLeavesAttached(world, stumpPos);

    await server.inspect('Leaf count', result.leafCount);
    await server.inspect('Has enough leaves (>=3)', result.hasLeaves);

    await server.assert(!result.hasLeaves, 'Stump should NOT have leaves');
    await server.end('Stump Detection PASSED!');
  }

  // Test 3: Side by side comparison
  {
    const world = new MockWorld();
    world.fill(new Vec3(-20, 63, -20), new Vec3(20, 63, 20), 'grass_block');
    createOakTree(world, new Vec3(-8, 64, 0), 5);
    createStump(world, new Vec3(8, 64, 0));

    await server.start(world, 'Tree vs Stump - Side by Side', {
      center: new Vec3(0, 70, 10),
    });

    await server.step('Created: Tree on LEFT, Stump on RIGHT');

    const treePos = new Vec3(-8, 64, 0);
    const stumpPos = new Vec3(8, 64, 0);

    await server.mark(treePos, 'Tree (left)', 'green');
    await server.mark(stumpPos, 'Stump (right)', 'red');

    await server.step('Checking the TREE (left)...');

    const treeResult = hasLeavesAttached(world, treePos);
    await server.inspect('Tree leaf count', treeResult.leafCount);
    await server.inspect('Tree has leaves', treeResult.hasLeaves);

    await server.step('Checking the STUMP (right)...');

    const stumpResult = hasLeavesAttached(world, stumpPos);
    await server.inspect('Stump leaf count', stumpResult.leafCount);
    await server.inspect('Stump has leaves', stumpResult.hasLeaves);

    await server.step('Comparing results...');

    await server.assert(treeResult.hasLeaves, 'Tree should have leaves');
    await server.assert(!stumpResult.hasLeaves, 'Stump should NOT have leaves');

    await server.end('Side-by-Side Comparison PASSED!');
  }

  // Test 4: Minimum leaf threshold
  {
    const world = new MockWorld();
    world.fill(new Vec3(-15, 63, -15), new Vec3(15, 63, 15), 'grass_block');
    world.setBlock(new Vec3(0, 64, 0), 'oak_log');
    world.setBlock(new Vec3(0, 65, 0), 'oak_leaves');
    world.setBlock(new Vec3(1, 65, 0), 'oak_leaves');

    await server.start(world, 'Tree Detection - Minimum Leaf Threshold', {
      center: new Vec3(0, 70, 5),
    });

    await server.step('Created a log with only 2 leaves (threshold is 3)');

    await server.mark(new Vec3(0, 64, 0), 'Log', 'orange');
    await server.mark(new Vec3(0, 65, 0), 'Leaf 1', 'lime');
    await server.mark(new Vec3(1, 65, 0), 'Leaf 2', 'lime');

    const result1 = hasLeavesAttached(world, new Vec3(0, 64, 0));
    await server.inspect('Leaf count', result1.leafCount);
    await server.inspect('Has enough leaves', result1.hasLeaves);

    await server.assert(!result1.hasLeaves, '2 leaves should NOT count as a tree');

    await server.step('Adding a third leaf...');

    world.setBlock(new Vec3(-1, 65, 0), 'oak_leaves');
    await server.mark(new Vec3(-1, 65, 0), 'Leaf 3', 'green');

    const result2 = hasLeavesAttached(world, new Vec3(0, 64, 0));
    await server.inspect('Leaf count after', result2.leafCount);
    await server.inspect('Has enough leaves', result2.hasLeaves);

    await server.assert(result2.hasLeaves, '3 leaves should count as a tree');

    await server.end('Leaf Threshold Test PASSED!');
  }

  console.log('\n🎉 All tree vs stump tests completed!\n');
  await server.shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
