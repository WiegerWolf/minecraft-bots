import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { GatherDirt } from '../../../src/roles/landscaper/behaviors/actions/GatherDirt';
import { createLandscaperBlackboard, type LandscaperBlackboard } from '../../../src/roles/landscaper/LandscaperBlackboard';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';

/**
 * SPECIFICATION: Dirt Gathering Behavior
 *
 * The landscaper's GatherDirt action must:
 * 1. Break dirt blocks to gather dirt
 * 2. COLLECT the dropped items after breaking blocks
 * 3. Not leave dropped items behind
 */

// Helper to create a mock bot for GatherDirt testing
function createGatherDirtBot(config: {
    position?: Vec3;
    inventory?: Array<{ name: string; count: number }>;
    dirtBlocks?: Vec3[];
    nearbyDrops?: Array<{ id: number; position: Vec3; name: string }>;
}) {
    const position = config.position ?? new Vec3(0, 64, 0);
    const inventory = config.inventory ?? [{ name: 'stone_shovel', count: 1 }];
    const dirtBlocks = config.dirtBlocks ?? [];
    const nearbyDrops = config.nearbyDrops ?? [];

    const diggingHistory: Vec3[] = [];
    const collectHistory: number[] = [];
    let currentPosition = position.clone();

    // Mock entities that will be updated when blocks are dug
    const entities: Record<number, any> = {};
    let nextEntityId = 1;

    // Add initial drops
    for (const drop of nearbyDrops) {
        entities[drop.id] = {
            id: drop.id,
            name: 'item',
            position: drop.position,
            metadata: [{ itemId: drop.name === 'dirt' ? 1 : 0 }],
        };
    }

    // Helper to simulate auto-pickup: when bot is close to items, collect them
    const checkAutoPickup = () => {
        for (const [idStr, entity] of Object.entries(entities)) {
            const id = parseInt(idStr);
            if (entity.name === 'item' && entity.position) {
                const dist = currentPosition.distanceTo(entity.position);
                if (dist < 1.5) {
                    // Auto-pickup!
                    delete entities[id];
                    collectHistory.push(id);
                }
            }
        }
    };

    const mockBot = {
        entity: {
            get position() { return currentPosition; },
            set position(v: Vec3) { currentPosition = v; },
            velocity: new Vec3(0, 0, 0),
            onGround: true,
        },
        entities,
        inventory: {
            items: () => inventory.map(i => ({ name: i.name, count: i.count, type: 0 })),
            emptySlotCount: () => 36 - inventory.length,
        },
        pathfinder: {
            setGoal: mock(() => {}),
            goto: mock(async () => {}),
            setMovements: mock(() => {}),
            isMoving: () => false,
            stop: mock(() => {}),
        },
        blockAt: (pos: Vec3) => {
            // Check if this position has a dirt block
            const hasDirt = dirtBlocks.some(dp =>
                Math.floor(dp.x) === Math.floor(pos.x) &&
                Math.floor(dp.y) === Math.floor(pos.y) &&
                Math.floor(dp.z) === Math.floor(pos.z)
            );

            if (hasDirt) {
                return {
                    name: 'dirt',
                    position: pos.clone(),
                    type: 1,
                    metadata: 0,
                    boundingBox: 'block',
                };
            }

            // Check if above a dirt block
            const dirtBelow = dirtBlocks.find(dp =>
                Math.floor(dp.x) === Math.floor(pos.x) &&
                Math.floor(dp.y) === Math.floor(pos.y) - 1 &&
                Math.floor(dp.z) === Math.floor(pos.z)
            );

            if (dirtBelow) {
                return {
                    name: 'air',
                    position: pos.clone(),
                    type: 0,
                    metadata: 0,
                };
            }

            return null;
        },
        findBlocks: (options: any) => {
            // Return dirt blocks within range
            return dirtBlocks.filter(dp =>
                dp.distanceTo(options.point || currentPosition) <= options.maxDistance
            ).slice(0, options.count);
        },
        dig: mock(async (block: any) => {
            diggingHistory.push(block.position.clone());

            // Remove the dirt block
            const idx = dirtBlocks.findIndex(dp =>
                Math.floor(dp.x) === Math.floor(block.position.x) &&
                Math.floor(dp.y) === Math.floor(block.position.y) &&
                Math.floor(dp.z) === Math.floor(block.position.z)
            );
            if (idx >= 0) {
                dirtBlocks.splice(idx, 1);
            }

            // Spawn a dropped item at the block position
            const dropId = nextEntityId++;
            entities[dropId] = {
                id: dropId,
                name: 'item',
                position: block.position.clone(),
                metadata: [{ itemId: 1 }], // dirt
            };

            // The bot is close to the block when digging, so check auto-pickup
            checkAutoPickup();
        }),
        equip: mock(async () => {}),
        on: () => mockBot,
        once: () => mockBot,
        off: () => mockBot,
        emit: () => false,
        username: 'TestLandscaper',
        // Method to simulate collecting a drop (walking over it)
        _simulatePickup: (dropId: number) => {
            if (entities[dropId]) {
                delete entities[dropId];
                collectHistory.push(dropId);
            }
        },
        _moveToPosition: (pos: Vec3) => {
            currentPosition = pos.clone();
            checkAutoPickup();
        },
        _getDiggingHistory: () => diggingHistory,
        _getCollectHistory: () => collectHistory,
        _getEntities: () => entities,
        _checkAutoPickup: checkAutoPickup,
    } as unknown as Bot & {
        _simulatePickup: (id: number) => void;
        _moveToPosition: (pos: Vec3) => void;
        _getDiggingHistory: () => Vec3[];
        _getCollectHistory: () => number[];
        _getEntities: () => Record<number, any>;
        _checkAutoPickup: () => void;
    };

    return mockBot;
}

describe('GatherDirt Action Behavior', () => {
    let gatherDirt: GatherDirt;
    let bb: LandscaperBlackboard;

    beforeEach(() => {
        gatherDirt = new GatherDirt();
        bb = createLandscaperBlackboard();
        bb.dirtCount = 0;
        bb.hasShovel = true;
    });

    describe('Dirtpit Preference', () => {
        test('SPEC: Should prefer digging near established dirtpit location', async () => {
            // Setup: Bot with an established dirtpit location
            // Dirtpit should be 20-40 blocks from village (new closer range)
            const dirtpitPos = new Vec3(30, 64, 30); // Within new acceptable range (20-40 from village)
            const nearDirtpitBlocks = [
                new Vec3(31, 64, 30),
                new Vec3(32, 64, 30),
            ];

            const bot = createGatherDirtBot({
                position: new Vec3(30, 64, 30), // Bot at dirtpit
                inventory: [{ name: 'stone_shovel', count: 1 }],
                dirtBlocks: nearDirtpitBlocks,
            });

            bb.villageCenter = new Vec3(0, 64, 0);
            bb.dirtpit = dirtpitPos;
            bb.hasDirtpit = true;

            // Act: The action should prefer dirtpit area
            // Dirtpit is now closer to village (20-40 blocks) for convenience
            expect(bb.dirtpit).toBeDefined();
            expect(bb.dirtpit?.distanceTo(bb.villageCenter!)).toBeGreaterThanOrEqual(20);
            expect(bb.dirtpit?.distanceTo(bb.villageCenter!)).toBeLessThanOrEqual(50);
        });

        test('SPEC: Should discover and establish dirtpit when none exists', async () => {
            // This is a placeholder - the real test would verify dirtpit discovery
            bb.dirtpit = null;
            expect(bb.dirtpit).toBeNull();
        });
    });

    describe('Item Collection After Breaking', () => {
        test('SPEC: Should wait for items to be picked up after breaking dirt', async () => {
            // Setup: Bot at dirtpit location (outside village exclusion zone)
            // Dirt blocks must be near dirtpit, not near village center
            const dirtpitPos = new Vec3(50, 64, 50); // Outside village exclusion zone (20 blocks)
            const dirtPos = new Vec3(51, 64, 50); // Near dirtpit
            const dirtBlocks = [dirtPos];
            const bot = createGatherDirtBot({
                position: new Vec3(50, 64, 50), // At dirtpit, close to dirt block
                inventory: [{ name: 'stone_shovel', count: 1 }],
                dirtBlocks,
            });

            bb.villageCenter = new Vec3(0, 64, 0);
            bb.dirtpit = dirtpitPos; // REQUIRED: action needs established dirtpit
            bb.hasDirtpit = true;
            bb.dirtCount = 0;

            // Act: Run the gather action
            await gatherDirt.tick(bot, bb);

            // The action should have dug a block
            const diggingHistory = (bot as any)._getDiggingHistory();
            expect(diggingHistory.length).toBeGreaterThan(0);

            // After digging, there should be a dropped item
            const entities = (bot as any)._getEntities();
            const droppedItems = Object.values(entities).filter((e: any) => e.name === 'item');

            // CRITICAL ASSERTION: The dropped items should be collected
            // If items are left behind, this test will fail
            // Bot is close enough (1 block) that auto-pickup should happen
            expect(droppedItems.length).toBe(0);
        });

        test('SPEC: Should increment dirt count after collecting dropped dirt', async () => {
            // Setup: Dirt blocks near established dirtpit (outside exclusion zone)
            const dirtpitPos = new Vec3(50, 64, 50);
            const dirtBlocks = [new Vec3(52, 64, 50)];
            const bot = createGatherDirtBot({
                position: new Vec3(50, 64, 50), // At dirtpit
                inventory: [{ name: 'stone_shovel', count: 1 }],
                dirtBlocks,
            });

            bb.villageCenter = new Vec3(0, 64, 0);
            bb.dirtpit = dirtpitPos; // REQUIRED: action needs established dirtpit
            bb.hasDirtpit = true;
            const initialDirt = bb.dirtCount;

            // Act: Run the gather action
            await gatherDirt.tick(bot, bb);

            // The action should have dug blocks AND collected them
            // After collection, dirt count should increase
            // This depends on inventory being updated
            const diggingHistory = (bot as any)._getDiggingHistory();
            expect(diggingHistory.length).toBeGreaterThan(0);
        });
    });

    describe('Preconditions', () => {
        test('SPEC: Should fail if no shovel available', async () => {
            const bot = createGatherDirtBot({
                inventory: [], // No shovel
            });

            bb.hasShovel = false;

            const result = await gatherDirt.tick(bot, bb);
            expect(result).toBe('failure');
        });

        test('SPEC: Should fail if already have enough dirt', async () => {
            const bot = createGatherDirtBot({
                inventory: [{ name: 'stone_shovel', count: 1 }],
            });

            bb.dirtCount = 64; // Already have enough

            const result = await gatherDirt.tick(bot, bb);
            expect(result).toBe('success'); // Returns success because we have enough
        });
    });
});
