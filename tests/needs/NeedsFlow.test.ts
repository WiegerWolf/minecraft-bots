import { describe, test, expect, beforeEach } from 'bun:test';
import { RecipeService } from '../../src/shared/needs/RecipeService';
import {
    generateNeedId,
    scoreOffer,
    rankOffers,
} from '../../src/shared/needs/types';
import type { Need, NeedOffer, ItemStack } from '../../src/shared/needs/types';
import {
    getItemsInCategory,
    itemMatchesCategory,
    inventoryHasCategory,
} from '../../src/shared/needs/ItemCategoryMap';

/**
 * Integration tests for the complete need fulfillment flow.
 * Tests the interaction between RecipeService, offer scoring, and category matching.
 */
describe('Need Fulfillment Flow', () => {
    let recipeService: RecipeService;

    beforeEach(() => {
        RecipeService.resetInstance();
        recipeService = RecipeService.getInstance('1.20.4');
    });

    describe('SPEC: Farmer broadcasts need for hoe, Lumberjack responds', () => {
        test('scenario: Lumberjack has wooden_hoe - offers item directly', () => {
            // Farmer needs a hoe
            const needCategory = 'hoe';
            const needId = generateNeedId('Farmer', needCategory);

            // Lumberjack checks inventory
            const lumberjackInventory: ItemStack[] = [
                { name: 'wooden_hoe', count: 1 },
                { name: 'oak_log', count: 10 },
            ];

            // RecipeService determines what can satisfy the need
            const result = recipeService.whatCanSatisfy(
                needCategory,
                lumberjackInventory,
                'Lumberjack'
            );

            // Should offer the hoe directly
            expect(result.canSatisfy).toBe(true);
            expect(result.bestOffer?.type).toBe('item');
            expect(result.bestOffer?.items[0]?.name).toBe('wooden_hoe');
            expect(result.bestOffer?.craftingSteps).toBe(0);
        });

        test('scenario: Lumberjack has planks+sticks - offers materials', () => {
            const needCategory = 'hoe';

            // Lumberjack has crafting materials but no hoe
            const lumberjackInventory: ItemStack[] = [
                { name: 'oak_planks', count: 10 },
                { name: 'stick', count: 10 },
            ];

            const result = recipeService.whatCanSatisfy(
                needCategory,
                lumberjackInventory,
                'Lumberjack'
            );

            // Should offer materials
            expect(result.canSatisfy).toBe(true);
            expect(result.bestOffer?.type).toBe('materials');
            expect(result.bestOffer?.craftingSteps).toBe(1);

            // Materials should include planks and sticks
            const hasplanks = result.bestOffer?.items.some(i => i.name.includes('planks'));
            const hasSticks = result.bestOffer?.items.some(i => i.name === 'stick');
            expect(hasplanks).toBe(true);
            expect(hasSticks).toBe(true);
        });

        test('scenario: Lumberjack has only logs - offers raw materials', () => {
            const needCategory = 'hoe';

            // Lumberjack has only logs
            const lumberjackInventory: ItemStack[] = [
                { name: 'oak_log', count: 10 },
            ];

            const result = recipeService.whatCanSatisfy(
                needCategory,
                lumberjackInventory,
                'Lumberjack'
            );

            // Should offer logs as materials (2 crafting steps: logs -> planks+sticks -> hoe)
            expect(result.canSatisfy).toBe(true);
            expect(result.bestOffer?.type).toBe('materials');
            expect(result.bestOffer?.craftingSteps).toBeGreaterThan(0);
        });
    });

    describe('SPEC: Multiple bots respond to same need', () => {
        test('item offer wins over material offer', () => {
            const offers: NeedOffer[] = [
                {
                    from: 'Bot1',
                    type: 'materials',
                    completeness: 'full',
                    items: [{ name: 'oak_planks', count: 2 }, { name: 'stick', count: 2 }],
                    craftingSteps: 1,
                    timestamp: 1000,
                },
                {
                    from: 'Bot2',
                    type: 'item',
                    completeness: 'full',
                    items: [{ name: 'stone_hoe', count: 1 }],
                    craftingSteps: 0,
                    timestamp: 2000, // Later timestamp
                },
            ];

            const ranked = rankOffers(offers);

            // Bot2 (item) should win despite later timestamp
            expect(ranked[0]!.from).toBe('Bot2');
            expect(ranked[0]!.craftingSteps).toBe(0);
        });

        test('earlier timestamp wins when offers are equal', () => {
            const offers: NeedOffer[] = [
                {
                    from: 'Bot1',
                    type: 'item',
                    completeness: 'full',
                    items: [{ name: 'wooden_hoe', count: 1 }],
                    craftingSteps: 0,
                    timestamp: 2000,
                },
                {
                    from: 'Bot2',
                    type: 'item',
                    completeness: 'full',
                    items: [{ name: 'stone_hoe', count: 1 }],
                    craftingSteps: 0,
                    timestamp: 1000, // Earlier
                },
            ];

            const ranked = rankOffers(offers);

            // Bot2 should win (earlier timestamp)
            expect(ranked[0]!.from).toBe('Bot2');
        });

        test('full offer beats partial offer', () => {
            const offers: NeedOffer[] = [
                {
                    from: 'Bot1',
                    type: 'materials',
                    completeness: 'partial',
                    items: [{ name: 'oak_planks', count: 1 }],
                    craftingSteps: 1,
                    timestamp: 1000,
                },
                {
                    from: 'Bot2',
                    type: 'materials',
                    completeness: 'full',
                    items: [{ name: 'oak_planks', count: 2 }, { name: 'stick', count: 2 }],
                    craftingSteps: 1,
                    timestamp: 2000,
                },
            ];

            const ranked = rankOffers(offers);

            // Bot2 (full) should win despite later timestamp
            expect(ranked[0]!.from).toBe('Bot2');
            expect(ranked[0]!.completeness).toBe('full');
        });
    });

    describe('SPEC: Category matching', () => {
        test('any hoe type satisfies hoe category', () => {
            const hoeTypes = getItemsInCategory('hoe');

            for (const hoeType of hoeTypes) {
                expect(itemMatchesCategory(hoeType, 'hoe')).toBe(true);
            }
        });

        test('any log type satisfies log category', () => {
            const logTypes = getItemsInCategory('log');

            expect(logTypes).toContain('oak_log');
            expect(logTypes).toContain('birch_log');
            expect(logTypes).toContain('spruce_log');

            for (const logType of logTypes) {
                expect(itemMatchesCategory(logType, 'log')).toBe(true);
            }
        });

        test('inventory check finds any item in category', () => {
            const inventory: ItemStack[] = [
                { name: 'stone_hoe', count: 1 },
                { name: 'dirt', count: 64 },
            ];

            const result = inventoryHasCategory(inventory, 'hoe');
            expect(result.has).toBe(true);
            expect(result.item).toBe('stone_hoe');
        });
    });

    describe('SPEC: Need ID generation', () => {
        test('generates IDs with correct format', () => {
            const id1 = generateNeedId('Farmer', 'hoe');

            // ID should be: botname-category-timestamp
            expect(id1.startsWith('Farmer-hoe-')).toBe(true);

            // Should have a numeric timestamp at the end
            const timestamp = id1.split('-').pop();
            expect(parseInt(timestamp!)).toBeGreaterThan(0);
        });

        test('different bots generate different IDs', () => {
            const id1 = generateNeedId('Farmer', 'hoe');
            const id2 = generateNeedId('Lumberjack', 'hoe');

            expect(id1).not.toBe(id2);
            expect(id1.startsWith('Farmer-')).toBe(true);
            expect(id2.startsWith('Lumberjack-')).toBe(true);
        });

        test('includes bot name and category in ID', () => {
            const id = generateNeedId('Lumberjack', 'axe');

            expect(id.startsWith('Lumberjack-axe-')).toBe(true);
        });
    });

    describe('SPEC: Recipe path expansion', () => {
        test('wooden_hoe has multiple material paths', () => {
            const paths = recipeService.getMaterialPaths('wooden_hoe', 2);

            // Should have at least:
            // - The item itself (craftingSteps: 0)
            // - Direct materials: planks + sticks (craftingSteps: 1)
            // - Raw materials: logs (craftingSteps: 2)
            expect(paths.length).toBeGreaterThanOrEqual(2);

            // Verify paths are ordered by crafting steps
            const stepCounts = paths.map(p => p.craftingSteps);
            expect(stepCounts[0]).toBe(0); // Item itself first
        });

        test('logs have no crafting path (raw material)', () => {
            const paths = recipeService.getMaterialPaths('oak_log', 2);

            // Only path is the item itself
            expect(paths.length).toBe(1);
            expect(paths[0]!.craftingSteps).toBe(0);
            expect(paths[0]!.items).toEqual([{ name: 'oak_log', count: 1 }]);
        });
    });

    describe('SPEC: Offer scoring edge cases', () => {
        test('zero crafting steps scores highest', () => {
            const directItem: NeedOffer = {
                from: 'Bot',
                type: 'item',
                completeness: 'full',
                items: [{ name: 'wooden_hoe', count: 1 }],
                craftingSteps: 0,
                timestamp: Date.now(),
            };

            const materials: NeedOffer = {
                from: 'Bot',
                type: 'materials',
                completeness: 'full',
                items: [{ name: 'oak_log', count: 1 }],
                craftingSteps: 2,
                timestamp: Date.now(),
            };

            expect(scoreOffer(directItem)).toBeGreaterThan(scoreOffer(materials));
        });

        test('chest nearby bonus applies', () => {
            const offer: NeedOffer = {
                from: 'Bot',
                type: 'item',
                completeness: 'full',
                items: [{ name: 'wooden_hoe', count: 1 }],
                craftingSteps: 0,
                timestamp: Date.now(),
            };

            const scoreWithChest = scoreOffer(offer, { chestNearby: true });
            const scoreWithoutChest = scoreOffer(offer, { chestNearby: false });

            expect(scoreWithChest).toBeGreaterThan(scoreWithoutChest);
        });
    });
});
