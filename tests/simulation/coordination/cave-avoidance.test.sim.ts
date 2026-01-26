#!/usr/bin/env bun
/**
 * Cave Avoidance Simulation Tests
 *
 * SPECIFICATION: Bots Must Stay Above Ground
 *
 * Farmers, lumberjacks, and landscapers should STRONGLY prefer staying
 * under clear sky (not in caves). This prevents bots from:
 * 1. Getting lost in cave systems
 * 2. Wasting time exploring underground areas where there are no useful resources
 * 3. Getting stuck in complex cave geometries
 *
 * The fix adds sky access checking to exploration candidate scoring,
 * with a heavy penalty (-200) for positions without clear sky above.
 */

import { Vec3 } from 'vec3';
import { pathfinder as pathfinderPlugin } from 'mineflayer-pathfinder';
import { SimulationTest, runSimulationTests } from '../SimulationTest';
import { MockWorld, createOakTree } from '../../mocks/MockWorld';
import { GOAPLumberjackRole } from '../../../src/roles/GOAPLumberjackRole';
import { GOAPFarmingRole } from '../../../src/roles/GOAPFarmingRole';

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Lumberjack finds surface forest (simple test)
// ═══════════════════════════════════════════════════════════════════════════

async function testLumberjackFindsSurfaceForest() {
    const test = new SimulationTest('Lumberjack finds surface forest');

    const world = new MockWorld();

    // Create ground surface - larger area
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    // Create a surface forest NEAR spawn (easy to find)
    const forestCenter = new Vec3(20, 64, 0);
    createOakTree(world, forestCenter.offset(0, 0, 0), 5);
    createOakTree(world, forestCenter.offset(4, 0, 2), 5);
    createOakTree(world, forestCenter.offset(-3, 0, 3), 5);
    createOakTree(world, forestCenter.offset(2, 0, -3), 5);
    createOakTree(world, forestCenter.offset(-2, 0, -2), 5);

    const spawnPos = new Vec3(0, 64, 0);

    await test.setup(world, {
        botPosition: spawnPos.clone(),
        botInventory: [
            { name: 'iron_axe', count: 1 },
            { name: 'oak_sign', count: 5 },
        ],
        clearRadius: 60,
    });

    test.bot.loadPlugin(pathfinderPlugin);
    await test.wait(2000, 'World loading');

    const role = new GOAPLumberjackRole();
    role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

    const bb = () => (role as any).blackboard;

    // Wait for bot to find the forest
    await test.waitUntil(
        () => bb()?.forestTrees?.length >= 3,
        { timeout: 90000, message: 'Bot should find forest trees on surface' }
    );

    // Verify bot found trees
    const forestTrees = bb()?.forestTrees as Array<{ position: Vec3 }>;
    test.assert(forestTrees.length >= 3, `Should have found 3+ trees (found ${forestTrees.length})`);

    // Bot should be near the forest
    const botPos = test.bot.entity.position;
    const distToForest = botPos.distanceTo(forestCenter);
    test.assert(
        distToForest < 30,
        `Bot should be near forest (dist=${distToForest.toFixed(1)}, expected < 30)`
    );

    role.stop(test.bot);
    return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer finds surface water and establishes farm
// ═══════════════════════════════════════════════════════════════════════════

async function testFarmerFindsSurfaceWater() {
    const test = new SimulationTest('Farmer finds surface water');

    const world = new MockWorld();

    // Create ground surface
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    // Create surface water pool NEAR spawn
    world.fill(
        new Vec3(15, 63, -3),
        new Vec3(20, 63, 3),
        'water'
    );

    const spawnPos = new Vec3(0, 64, 0);

    await test.setup(world, {
        botPosition: spawnPos.clone(),
        botInventory: [
            { name: 'iron_hoe', count: 1 },
            { name: 'wheat_seeds', count: 32 },
        ],
        clearRadius: 60,
    });

    test.bot.loadPlugin(pathfinderPlugin);
    await test.wait(2000, 'World loading');

    const role = new GOAPFarmingRole();
    role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: spawnPos.clone() });

    const bb = () => (role as any).blackboard;

    // Wait for bot to establish farm center
    await test.waitUntil(
        () => bb()?.farmCenter !== null,
        { timeout: 90000, message: 'Bot should establish farm center near water' }
    );

    const farmCenter = bb()?.farmCenter as Vec3;
    test.assert(farmCenter !== null, 'Should have established farm center');

    console.log(`  Farm center at (${farmCenter.x.toFixed(0)}, ${farmCenter.y.toFixed(0)}, ${farmCenter.z.toFixed(0)})`);

    // Farm should be near the water (X=15-20)
    test.assert(
        farmCenter.x > 10 && farmCenter.x < 30,
        `Farm center should be near water (X=${farmCenter.x.toFixed(0)}, expected 10-30)`
    );

    role.stop(test.bot);
    return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Bot stays on surface during exploration (tracking test)
// ═══════════════════════════════════════════════════════════════════════════

async function testBotStaysOnSurface() {
    const test = new SimulationTest('Bot stays on surface during exploration');

    const world = new MockWorld();

    // Create ground surface
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    // Create a forest to give the lumberjack something to do
    const forestCenter = new Vec3(25, 64, 25);
    createOakTree(world, forestCenter.offset(0, 0, 0), 5);
    createOakTree(world, forestCenter.offset(3, 0, 2), 5);
    createOakTree(world, forestCenter.offset(-2, 0, 3), 5);

    const spawnPos = new Vec3(0, 64, 0);

    await test.setup(world, {
        botPosition: spawnPos.clone(),
        botInventory: [
            { name: 'iron_axe', count: 1 },
            { name: 'oak_sign', count: 5 },
        ],
        clearRadius: 60,
    });

    test.bot.loadPlugin(pathfinderPlugin);
    await test.wait(2000, 'World loading');

    const role = new GOAPLumberjackRole();
    role.start(test.bot, { logger: test.createRoleLogger('lumberjack'), spawnPosition: spawnPos.clone() });

    // Track bot's Y position over time - should stay near surface (Y=64)
    let minY = 1000;
    let maxY = -1000;
    const positionTracker = setInterval(() => {
        const pos = test.bot.entity.position;
        if (pos.y < minY) minY = pos.y;
        if (pos.y > maxY) maxY = pos.y;
    }, 500);

    // Let the bot explore for 45 seconds
    await test.wait(45000, 'Letting bot explore');

    clearInterval(positionTracker);

    console.log(`  Bot Y range: ${minY.toFixed(1)} to ${maxY.toFixed(1)}`);

    // Bot should stay near surface level (Y=62-70 is reasonable)
    test.assert(
        minY >= 55,
        `Bot should not go underground (min Y=${minY.toFixed(1)}, expected >= 55)`
    );

    test.assert(
        maxY <= 85,
        `Bot should not climb too high (max Y=${maxY.toFixed(1)}, expected <= 85)`
    );

    role.stop(test.bot);
    return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Farmer establishes farm with proper sky access
// ═══════════════════════════════════════════════════════════════════════════

async function testFarmerFarmsUnderSky() {
    const test = new SimulationTest('Farmer farms under clear sky');

    const world = new MockWorld();

    // Create ground surface
    world.fill(new Vec3(-50, 63, -50), new Vec3(50, 63, 50), 'grass_block');

    // Create water pool
    world.fill(new Vec3(10, 63, -2), new Vec3(14, 63, 2), 'water');

    const spawnPos = new Vec3(0, 64, 0);

    await test.setup(world, {
        botPosition: spawnPos.clone(),
        botInventory: [
            { name: 'iron_hoe', count: 1 },
            { name: 'wheat_seeds', count: 64 },
        ],
        clearRadius: 60,
    });

    test.bot.loadPlugin(pathfinderPlugin);
    await test.wait(2000, 'World loading');

    const role = new GOAPFarmingRole();
    role.start(test.bot, { logger: test.createRoleLogger('farmer'), spawnPosition: spawnPos.clone() });

    const bb = () => (role as any).blackboard;

    // Wait for bot to start farming (tilling or planting)
    await test.waitUntil(
        () => {
            const farmCenter = bb()?.farmCenter;
            const lastAction = bb()?.lastAction;
            return farmCenter !== null && (lastAction === 'till_ground' || lastAction === 'plant_seeds' || lastAction === 'harvest_crops');
        },
        { timeout: 120000, message: 'Bot should start farming activities' }
    );

    const farmCenter = bb()?.farmCenter as Vec3;
    console.log(`  Farming at (${farmCenter.x.toFixed(0)}, ${farmCenter.y.toFixed(0)}, ${farmCenter.z.toFixed(0)})`);

    // Farm should be on surface (Y ~ 63-64)
    test.assert(
        farmCenter.y >= 62 && farmCenter.y <= 70,
        `Farm should be on surface level (Y=${farmCenter.y}, expected 62-70)`
    );

    role.stop(test.bot);
    return test.cleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const ALL_TESTS: Record<string, () => Promise<any>> = {
    'lumberjack-surface': testLumberjackFindsSurfaceForest,
    'farmer-surface': testFarmerFindsSurfaceWater,
    'stays-on-surface': testBotStaysOnSurface,
    'farmer-farms-sky': testFarmerFarmsUnderSky,
};

async function main() {
    const testName = process.argv[2];

    if (testName === '--list' || testName === '-l') {
        console.log('Available tests:', Object.keys(ALL_TESTS).join(', '));
        process.exit(0);
    }

    let testsToRun: Array<() => Promise<any>>;

    if (testName && ALL_TESTS[testName]) {
        testsToRun = [ALL_TESTS[testName]];
    } else if (testName) {
        console.error(`Unknown test: ${testName}`);
        process.exit(1);
    } else {
        testsToRun = Object.values(ALL_TESTS);
    }

    const { passed, failed } = await runSimulationTests(testsToRun);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
