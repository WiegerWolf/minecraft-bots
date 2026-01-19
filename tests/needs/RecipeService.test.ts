import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RecipeService } from '../../src/shared/needs/RecipeService';
import {
    getItemsInCategory,
    getCategoryForItem,
    itemMatchesCategory,
    inventoryHasCategory,
    getBestAvailableInCategory,
} from '../../src/shared/needs/ItemCategoryMap';
import { scoreOffer, rankOffers } from '../../src/shared/needs/types';
import type { NeedOffer } from '../../src/shared/needs/types';

describe('RecipeService', () => {
    let service: RecipeService;

    beforeEach(() => {
        RecipeService.resetInstance();
        service = RecipeService.getInstance('1.20.4');
    });

    afterEach(() => {
        RecipeService.resetInstance();
    });

    describe('singleton pattern', () => {
        test('getInstance returns same instance', () => {
            const instance1 = RecipeService.getInstance();
            const instance2 = RecipeService.getInstance();
            expect(instance1).toBe(instance2);
        });

        test('resetInstance clears singleton', () => {
            const instance1 = RecipeService.getInstance();
            RecipeService.resetInstance();
            const instance2 = RecipeService.getInstance();
            expect(instance1).not.toBe(instance2);
        });
    });

    describe('item lookup', () => {
        test('getItemName returns correct name for ID', () => {
            expect(service.getItemName(844)).toBe('stick');
        });

        test('getItemId returns correct ID for name', () => {
            expect(service.getItemId('stick')).toBe(844);
        });

        test('getItemName returns null for invalid ID', () => {
            expect(service.getItemName(999999)).toBeNull();
        });

        test('getItemId returns null for invalid name', () => {
            expect(service.getItemId('nonexistent_item')).toBeNull();
        });
    });

    describe('getRecipesFor', () => {
        test('returns recipes for stick', () => {
            const recipes = service.getRecipesFor('stick');
            expect(recipes.length).toBeGreaterThan(0);
        });

        test('returns recipes for wooden_hoe', () => {
            const recipes = service.getRecipesFor('wooden_hoe');
            expect(recipes.length).toBeGreaterThan(0);
        });

        test('returns empty array for items without recipes', () => {
            const recipes = service.getRecipesFor('oak_log');
            expect(recipes.length).toBe(0);
        });

        test('returns empty array for nonexistent items', () => {
            const recipes = service.getRecipesFor('nonexistent_item');
            expect(recipes.length).toBe(0);
        });
    });

    describe('extractIngredients', () => {
        test('extracts ingredients from shaped recipe', () => {
            const recipes = service.getRecipesFor('wooden_hoe');
            expect(recipes.length).toBeGreaterThan(0);
            const firstRecipe = recipes[0]!;
            const ingredients = service.extractIngredients(firstRecipe);

            // wooden_hoe needs 2 planks + 2 sticks
            expect(ingredients).toContainEqual({ name: 'oak_planks', count: 2 });
            expect(ingredients).toContainEqual({ name: 'stick', count: 2 });
        });

        test('extracts ingredients from shapeless recipe', () => {
            const recipes = service.getRecipesFor('oak_planks');
            expect(recipes.length).toBeGreaterThan(0);
            const firstRecipe = recipes[0]!;
            const ingredients = service.extractIngredients(firstRecipe);

            // oak_planks needs 1 oak_log
            expect(ingredients.some((i) => i.name === 'oak_log')).toBe(true);
            expect(ingredients[0]!.count).toBe(1);
        });
    });

    describe('getMaterialPaths', () => {
        test('returns item itself as first path', () => {
            const paths = service.getMaterialPaths('wooden_hoe');
            expect(paths[0]).toEqual({
                items: [{ name: 'wooden_hoe', count: 1 }],
                craftingSteps: 0,
            });
        });

        test('returns direct crafting path for wooden_hoe', () => {
            const paths = service.getMaterialPaths('wooden_hoe');

            // Find path with craftingSteps = 1 (direct craft)
            const directPath = paths.find((p) => p.craftingSteps === 1);
            expect(directPath).toBeDefined();

            // Should need planks and sticks
            expect(directPath!.items.some((i) => i.name.includes('planks'))).toBe(
                true
            );
            expect(directPath!.items.some((i) => i.name === 'stick')).toBe(true);
        });

        test('returns raw material path for wooden_hoe with depth 2', () => {
            const paths = service.getMaterialPaths('wooden_hoe', 2);

            // Find deepest path
            const rawPath = paths.find((p) => p.craftingSteps === 2);
            expect(rawPath).toBeDefined();

            // At depth 2, planks should expand to logs
            // sticks should expand to planks which come from logs
            // So we should see logs in the raw path
            const hasLogs = rawPath!.items.some((i) => i.name.includes('_log'));
            expect(hasLogs).toBe(true);
        });

        test('returns only item itself for raw materials', () => {
            const paths = service.getMaterialPaths('oak_log');
            expect(paths.length).toBe(1);
            expect(paths[0]).toEqual({
                items: [{ name: 'oak_log', count: 1 }],
                craftingSteps: 0,
            });
        });

        test('caches results', () => {
            const paths1 = service.getMaterialPaths('wooden_hoe');
            const paths2 = service.getMaterialPaths('wooden_hoe');
            expect(paths1).toBe(paths2); // Same reference
        });

        test('clearCache invalidates cache', () => {
            const paths1 = service.getMaterialPaths('wooden_hoe');
            service.clearCache();
            const paths2 = service.getMaterialPaths('wooden_hoe');
            expect(paths1).not.toBe(paths2); // Different reference
            expect(paths1).toEqual(paths2); // Same content
        });
    });

    describe('whatCanSatisfy', () => {
        test('returns item offer when inventory has exact item', () => {
            const inventory = [{ name: 'wooden_hoe', count: 1 }];
            const result = service.whatCanSatisfy('hoe', inventory, 'TestBot');

            expect(result.canSatisfy).toBe(true);
            expect(result.completeness).toBe(100);
            expect(result.bestOffer?.type).toBe('item');
            expect(result.bestOffer?.items).toContainEqual({
                name: 'wooden_hoe',
                count: 1,
            });
            expect(result.bestOffer?.craftingSteps).toBe(0);
        });

        test('returns materials offer when inventory has crafting materials', () => {
            const inventory = [
                { name: 'oak_planks', count: 4 },
                { name: 'stick', count: 4 },
            ];
            const result = service.whatCanSatisfy('hoe', inventory, 'TestBot');

            expect(result.canSatisfy).toBe(true);
            expect(result.completeness).toBe(100);
            expect(result.bestOffer?.type).toBe('materials');
            expect(result.bestOffer?.craftingSteps).toBeGreaterThan(0);
        });

        test('prefers direct item over materials', () => {
            const inventory = [
                { name: 'wooden_hoe', count: 1 },
                { name: 'oak_planks', count: 10 },
                { name: 'stick', count: 10 },
            ];
            const result = service.whatCanSatisfy('hoe', inventory, 'TestBot');

            expect(result.bestOffer?.type).toBe('item');
            expect(result.bestOffer?.craftingSteps).toBe(0);
        });

        test('returns partial satisfaction when materials are incomplete', () => {
            const inventory = [
                { name: 'oak_planks', count: 2 }, // Have planks
                // Missing sticks
            ];
            const result = service.whatCanSatisfy('hoe', inventory, 'TestBot');

            if (result.canSatisfy) {
                expect(result.completeness).toBeLessThan(100);
                expect(result.bestOffer?.completeness).toBe('partial');
            }
        });

        test('returns cannot satisfy when inventory is empty', () => {
            const inventory: { name: string; count: number }[] = [];
            const result = service.whatCanSatisfy('hoe', inventory, 'TestBot');

            expect(result.canSatisfy).toBe(false);
            expect(result.bestOffer).toBeNull();
        });

        test('handles any item in category', () => {
            const inventory = [{ name: 'stone_hoe', count: 1 }];
            const result = service.whatCanSatisfy('hoe', inventory, 'TestBot');

            expect(result.canSatisfy).toBe(true);
            expect(result.bestOffer?.items).toContainEqual({
                name: 'stone_hoe',
                count: 1,
            });
        });
    });

    describe('getSimplestPath', () => {
        test('returns simplest crafting path', () => {
            const path = service.getSimplestPath('wooden_hoe');
            expect(path).toBeDefined();
            expect(path!.craftingSteps).toBe(1);
        });

        test('returns null for raw materials', () => {
            const path = service.getSimplestPath('oak_log');
            expect(path).toBeNull();
        });
    });

    describe('getRawMaterials', () => {
        test('returns deepest expansion', () => {
            const path = service.getRawMaterials('wooden_hoe');
            expect(path).toBeDefined();
            expect(path!.craftingSteps).toBeGreaterThan(1);

            // Should have logs as raw materials
            expect(path!.items.some((i) => i.name.includes('log'))).toBe(true);
        });
    });
});

describe('ItemCategoryMap', () => {
    describe('getItemsInCategory', () => {
        test('returns all hoe types for "hoe" category', () => {
            const items = getItemsInCategory('hoe');
            expect(items).toContain('wooden_hoe');
            expect(items).toContain('stone_hoe');
            expect(items).toContain('iron_hoe');
            expect(items).toContain('diamond_hoe');
        });

        test('returns all log types for "log" category', () => {
            const items = getItemsInCategory('log');
            expect(items).toContain('oak_log');
            expect(items).toContain('spruce_log');
            expect(items).toContain('birch_log');
        });

        test('returns item itself for unknown category', () => {
            const items = getItemsInCategory('specific_item');
            expect(items).toEqual(['specific_item']);
        });
    });

    describe('getCategoryForItem', () => {
        test('returns "hoe" for wooden_hoe', () => {
            expect(getCategoryForItem('wooden_hoe')).toBe('hoe');
        });

        test('returns "log" for oak_log', () => {
            expect(getCategoryForItem('oak_log')).toBe('log');
        });

        test('returns null for uncategorized items', () => {
            expect(getCategoryForItem('random_item')).toBeNull();
        });
    });

    describe('itemMatchesCategory', () => {
        test('wooden_hoe matches hoe category', () => {
            expect(itemMatchesCategory('wooden_hoe', 'hoe')).toBe(true);
        });

        test('oak_log matches log category', () => {
            expect(itemMatchesCategory('oak_log', 'log')).toBe(true);
        });

        test('wooden_hoe does not match axe category', () => {
            expect(itemMatchesCategory('wooden_hoe', 'axe')).toBe(false);
        });

        test('exact match works for specific items', () => {
            expect(itemMatchesCategory('specific_item', 'specific_item')).toBe(true);
        });
    });

    describe('inventoryHasCategory', () => {
        test('finds item in category', () => {
            const inventory = [{ name: 'wooden_hoe', count: 1 }];
            const result = inventoryHasCategory(inventory, 'hoe');
            expect(result.has).toBe(true);
            expect(result.item).toBe('wooden_hoe');
            expect(result.count).toBe(1);
        });

        test('returns false when category not in inventory', () => {
            const inventory = [{ name: 'oak_log', count: 10 }];
            const result = inventoryHasCategory(inventory, 'hoe');
            expect(result.has).toBe(false);
            expect(result.item).toBeNull();
        });

        test('respects minCount', () => {
            const inventory = [{ name: 'oak_log', count: 3 }];

            const result1 = inventoryHasCategory(inventory, 'log', 3);
            expect(result1.has).toBe(true);

            const result2 = inventoryHasCategory(inventory, 'log', 5);
            expect(result2.has).toBe(false);
        });
    });

    describe('getBestAvailableInCategory', () => {
        test('returns highest tier available', () => {
            const inventory = [
                { name: 'wooden_hoe', count: 1 },
                { name: 'stone_hoe', count: 1 },
                { name: 'iron_hoe', count: 1 },
            ];
            const result = getBestAvailableInCategory(inventory, 'hoe');
            expect(result?.item).toBe('iron_hoe');
        });

        test('returns null when category not available', () => {
            const inventory = [{ name: 'oak_log', count: 10 }];
            const result = getBestAvailableInCategory(inventory, 'hoe');
            expect(result).toBeNull();
        });

        test('skips items with zero count', () => {
            const inventory = [
                { name: 'diamond_hoe', count: 0 },
                { name: 'stone_hoe', count: 1 },
            ];
            const result = getBestAvailableInCategory(inventory, 'hoe');
            expect(result?.item).toBe('stone_hoe');
        });
    });
});

describe('Offer Scoring', () => {
    describe('scoreOffer', () => {
        test('scores direct item higher than materials', () => {
            const itemOffer: NeedOffer = {
                from: 'Bot1',
                type: 'item',
                completeness: 'full',
                items: [{ name: 'wooden_hoe', count: 1 }],
                craftingSteps: 0,
                timestamp: Date.now(),
            };

            const materialOffer: NeedOffer = {
                from: 'Bot2',
                type: 'materials',
                completeness: 'full',
                items: [
                    { name: 'oak_planks', count: 2 },
                    { name: 'stick', count: 2 },
                ],
                craftingSteps: 1,
                timestamp: Date.now(),
            };

            expect(scoreOffer(itemOffer)).toBeGreaterThan(scoreOffer(materialOffer));
        });

        test('scores full offer higher than partial', () => {
            const fullOffer: NeedOffer = {
                from: 'Bot1',
                type: 'materials',
                completeness: 'full',
                items: [{ name: 'oak_planks', count: 2 }],
                craftingSteps: 1,
                timestamp: Date.now(),
            };

            const partialOffer: NeedOffer = {
                from: 'Bot2',
                type: 'materials',
                completeness: 'partial',
                items: [{ name: 'oak_planks', count: 1 }],
                craftingSteps: 1,
                timestamp: Date.now(),
            };

            expect(scoreOffer(fullOffer)).toBeGreaterThan(scoreOffer(partialOffer));
        });

        test('scores fewer crafting steps higher', () => {
            const oneStep: NeedOffer = {
                from: 'Bot1',
                type: 'materials',
                completeness: 'full',
                items: [{ name: 'oak_planks', count: 2 }],
                craftingSteps: 1,
                timestamp: Date.now(),
            };

            const twoSteps: NeedOffer = {
                from: 'Bot2',
                type: 'materials',
                completeness: 'full',
                items: [{ name: 'oak_log', count: 1 }],
                craftingSteps: 2,
                timestamp: Date.now(),
            };

            expect(scoreOffer(oneStep)).toBeGreaterThan(scoreOffer(twoSteps));
        });
    });

    describe('rankOffers', () => {
        test('ranks offers by score descending', () => {
            const offers: NeedOffer[] = [
                {
                    from: 'Bot1',
                    type: 'materials',
                    completeness: 'full',
                    items: [{ name: 'oak_log', count: 1 }],
                    craftingSteps: 2,
                    timestamp: 1000,
                },
                {
                    from: 'Bot2',
                    type: 'item',
                    completeness: 'full',
                    items: [{ name: 'wooden_hoe', count: 1 }],
                    craftingSteps: 0,
                    timestamp: 2000,
                },
                {
                    from: 'Bot3',
                    type: 'materials',
                    completeness: 'full',
                    items: [{ name: 'oak_planks', count: 2 }],
                    craftingSteps: 1,
                    timestamp: 3000,
                },
            ];

            const ranked = rankOffers(offers);

            // Bot2 (item) should be first
            expect(ranked[0]!.from).toBe('Bot2');
            // Bot3 (1 step) should be second
            expect(ranked[1]!.from).toBe('Bot3');
            // Bot1 (2 steps) should be last
            expect(ranked[2]!.from).toBe('Bot1');
        });

        test('uses timestamp as tiebreaker', () => {
            const offers: NeedOffer[] = [
                {
                    from: 'Bot1',
                    type: 'item',
                    completeness: 'full',
                    items: [{ name: 'wooden_hoe', count: 1 }],
                    craftingSteps: 0,
                    timestamp: 2000, // Later
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

            // Same score, Bot2 should win (earlier timestamp)
            expect(ranked[0]!.from).toBe('Bot2');
            expect(ranked[1]!.from).toBe('Bot1');
        });
    });
});
