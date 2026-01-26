import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { hasClearSky, isYLevelSafe, MIN_SAFE_EXPLORATION_Y, MAX_SAFE_EXPLORATION_Y, NO_SKY_PENALTY, UNSAFE_Y_PENALTY } from '../../src/shared/TerrainUtils';

/**
 * SPECIFICATION: Terrain Utilities
 *
 * The TerrainUtils module provides shared helpers for terrain analysis
 * to prevent bots from exploring into caves or unsafe areas.
 */

describe('TerrainUtils', () => {
    describe('Constants', () => {
        test('SPEC: MIN_SAFE_EXPLORATION_Y is 55 (below sea level)', () => {
            expect(MIN_SAFE_EXPLORATION_Y).toBe(55);
        });

        test('SPEC: MAX_SAFE_EXPLORATION_Y is 85 (above typical trees)', () => {
            expect(MAX_SAFE_EXPLORATION_Y).toBe(85);
        });

        test('SPEC: NO_SKY_PENALTY is very negative (-200)', () => {
            expect(NO_SKY_PENALTY).toBe(-200);
        });

        test('SPEC: UNSAFE_Y_PENALTY is moderately negative (-100)', () => {
            expect(UNSAFE_Y_PENALTY).toBe(-100);
        });
    });

    describe('isYLevelSafe', () => {
        test('SPEC: Y=55 is safe (boundary)', () => {
            expect(isYLevelSafe(55)).toBe(true);
        });

        test('SPEC: Y=85 is safe (boundary)', () => {
            expect(isYLevelSafe(85)).toBe(true);
        });

        test('SPEC: Y=64 is safe (typical surface)', () => {
            expect(isYLevelSafe(64)).toBe(true);
        });

        test('SPEC: Y=54 is NOT safe (underground)', () => {
            expect(isYLevelSafe(54)).toBe(false);
        });

        test('SPEC: Y=86 is NOT safe (mountain)', () => {
            expect(isYLevelSafe(86)).toBe(false);
        });

        test('SPEC: Y=10 is NOT safe (deep underground)', () => {
            expect(isYLevelSafe(10)).toBe(false);
        });

        test('SPEC: Y=200 is NOT safe (extreme height)', () => {
            expect(isYLevelSafe(200)).toBe(false);
        });
    });

    describe('hasClearSky', () => {
        // Create a minimal mock bot for testing
        const createMockBot = (blocks: Map<string, { name: string; transparent?: boolean }>) => {
            return {
                blockAt: (pos: Vec3) => {
                    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
                    const block = blocks.get(key);
                    if (!block) {
                        return { name: 'air', transparent: true };
                    }
                    return block;
                }
            } as any;
        };

        test('SPEC: Clear sky returns true for open air', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            // Just air above
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(true);
        });

        test('SPEC: Stone ceiling blocks sky', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            // Stone ceiling at y=70
            blocks.set('0,70,0', { name: 'stone', transparent: false });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(false);
        });

        test('SPEC: Dirt ceiling blocks sky', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            blocks.set('0,68,0', { name: 'dirt', transparent: false });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(false);
        });

        test('SPEC: Leaves do NOT block sky (clearable)', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            blocks.set('0,70,0', { name: 'oak_leaves', transparent: true });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(true);
        });

        test('SPEC: Logs do NOT block sky (clearable)', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            blocks.set('0,68,0', { name: 'oak_log', transparent: false });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(true);
        });

        test('SPEC: Glass does NOT block sky (transparent)', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            blocks.set('0,70,0', { name: 'glass', transparent: true });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(true);
        });

        test('SPEC: cave_air is treated as air (clear)', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            blocks.set('0,66,0', { name: 'cave_air', transparent: true });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(true);
        });

        test('SPEC: Multiple blocks above - stone at any height blocks', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            // Air then leaves then stone
            blocks.set('0,66,0', { name: 'air', transparent: true });
            blocks.set('0,70,0', { name: 'oak_leaves', transparent: true });
            blocks.set('0,80,0', { name: 'stone', transparent: false }); // Cave ceiling far above
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            expect(hasClearSky(bot, pos, 0)).toBe(false);
        });

        test('SPEC: checkRadius=0 only checks center column', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            // Stone to the side but not above
            blocks.set('2,70,0', { name: 'stone', transparent: false });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            // With radius 0, should ignore the stone
            expect(hasClearSky(bot, pos, 0)).toBe(true);
        });

        test('SPEC: checkRadius>0 checks surrounding columns', () => {
            const blocks = new Map<string, { name: string; transparent?: boolean }>();
            // Stone to the side at radius distance
            blocks.set('2,70,0', { name: 'stone', transparent: false });
            const bot = createMockBot(blocks);
            const pos = new Vec3(0, 64, 0);

            // With radius 2, should detect the stone
            expect(hasClearSky(bot, pos, 2)).toBe(false);
        });
    });

    describe('Integration: Exploration Scoring Impact', () => {
        test('SPEC: Cave position gets -200 penalty', () => {
            // Simulate exploration scoring logic
            let score = 100; // Base score
            const hasSky = false; // Cave position

            if (!hasSky) {
                score += NO_SKY_PENALTY;
            }

            expect(score).toBe(-100); // 100 + (-200) = -100
        });

        test('SPEC: Underground Y level gets -100 penalty', () => {
            let score = 100;
            const y = 50; // Underground

            if (!isYLevelSafe(y)) {
                score += UNSAFE_Y_PENALTY;
            }

            expect(score).toBe(0); // 100 + (-100) = 0
        });

        test('SPEC: Cave + underground gets both penalties', () => {
            let score = 100;
            const hasSky = false;
            const y = 50;

            if (!hasSky) {
                score += NO_SKY_PENALTY;
            }
            if (!isYLevelSafe(y)) {
                score += UNSAFE_Y_PENALTY;
            }

            expect(score).toBe(-200); // 100 + (-200) + (-100) = -200
        });

        test('SPEC: Surface position with sky gets no penalty', () => {
            let score = 100;
            const hasSky = true;
            const y = 64;

            if (!hasSky) {
                score += NO_SKY_PENALTY;
            }
            if (!isYLevelSafe(y)) {
                score += UNSAFE_Y_PENALTY;
            }

            expect(score).toBe(100); // No penalties applied
        });
    });
});
