/**
 * Recipe Service
 *
 * Provides recipe resolution and material path calculation for the need system.
 * Uses minecraft-data to look up recipes and expand them recursively.
 */

import minecraftData from 'minecraft-data';
import type { ItemStack, MaterialPath, SatisfactionResult, NeedOffer } from './types.js';
import { getItemsInCategory, inventoryHasCategory } from './ItemCategoryMap.js';

interface MinecraftDataInstance {
    items: Record<number, { id: number; name: string }>;
    itemsByName: Record<string, { id: number; name: string }>;
    recipes: Record<number, Recipe[]>;
}

interface Recipe {
    inShape?: (number | null)[][]; // Shaped recipe
    ingredients?: number[]; // Shapeless recipe
    result: { count: number; id: number };
}

/**
 * Singleton service for recipe resolution.
 * Caches material paths to avoid redundant calculations.
 */
export class RecipeService {
    private static instance: RecipeService | null = null;
    private mcData: MinecraftDataInstance;
    private recipeCache: Map<string, MaterialPath[]> = new Map();

    constructor(version: string = '1.20.4') {
        this.mcData = minecraftData(version) as unknown as MinecraftDataInstance;
    }

    /**
     * Get singleton instance.
     */
    static getInstance(version: string = '1.20.4'): RecipeService {
        if (!RecipeService.instance) {
            RecipeService.instance = new RecipeService(version);
        }
        return RecipeService.instance;
    }

    /**
     * Reset singleton (for testing).
     */
    static resetInstance(): void {
        RecipeService.instance = null;
    }

    /**
     * Get item name from ID.
     */
    getItemName(id: number): string | null {
        return this.mcData.items[id]?.name ?? null;
    }

    /**
     * Get item ID from name.
     */
    getItemId(name: string): number | null {
        return this.mcData.itemsByName[name]?.id ?? null;
    }

    /**
     * Get all recipes that produce a given item.
     */
    getRecipesFor(itemName: string): Recipe[] {
        const itemId = this.getItemId(itemName);
        if (itemId === null) return [];
        return this.mcData.recipes[itemId] ?? [];
    }

    /**
     * Extract ingredients from a recipe.
     * Returns a map of item name to count needed.
     */
    extractIngredients(recipe: Recipe): ItemStack[] {
        const counts = new Map<string, number>();

        if (recipe.inShape) {
            // Shaped recipe
            for (const row of recipe.inShape) {
                for (const itemId of row) {
                    if (itemId !== null) {
                        const name = this.getItemName(itemId);
                        if (name) {
                            counts.set(name, (counts.get(name) ?? 0) + 1);
                        }
                    }
                }
            }
        } else if (recipe.ingredients) {
            // Shapeless recipe
            for (const itemId of recipe.ingredients) {
                const name = this.getItemName(itemId);
                if (name) {
                    counts.set(name, (counts.get(name) ?? 0) + 1);
                }
            }
        }

        return Array.from(counts.entries()).map(([name, count]) => ({
            name,
            count,
        }));
    }

    /**
     * Get all material paths that can produce this item.
     * Recursively expands recipes up to maxDepth.
     *
     * @param itemName - The item to get paths for
     * @param maxDepth - Maximum crafting depth (default 2 = raw materials)
     * @returns Array of MaterialPaths, ordered by crafting steps (0 first)
     */
    getMaterialPaths(itemName: string, maxDepth: number = 2): MaterialPath[] {
        const cacheKey = `${itemName}:${maxDepth}`;
        const cached = this.recipeCache.get(cacheKey);
        if (cached) return cached;

        const paths: MaterialPath[] = [];

        // Path 0: The item itself (craftingSteps = 0)
        paths.push({
            items: [{ name: itemName, count: 1 }],
            craftingSteps: 0,
        });

        // Get recipes for this item
        const recipes = this.getRecipesFor(itemName);
        if (recipes.length === 0) {
            this.recipeCache.set(cacheKey, paths);
            return paths;
        }

        // Add direct crafting paths (craftingSteps = 1)
        const seenIngredientSets = new Set<string>();
        for (const recipe of recipes) {
            const ingredients = this.extractIngredients(recipe);
            if (ingredients.length === 0) continue;

            // Deduplicate identical ingredient sets
            const key = ingredients
                .map((i) => `${i.name}:${i.count}`)
                .sort()
                .join(',');
            if (seenIngredientSets.has(key)) continue;
            seenIngredientSets.add(key);

            paths.push({
                items: ingredients,
                craftingSteps: 1,
            });

            // Recursively expand if we have depth remaining
            if (maxDepth > 1) {
                const expandedPaths = this.expandIngredients(ingredients, maxDepth - 1);
                for (const expanded of expandedPaths) {
                    // Add 1 for the final crafting step
                    paths.push({
                        items: expanded.items,
                        craftingSteps: expanded.craftingSteps + 1,
                    });
                }
            }
        }

        // Remove duplicate paths
        const uniquePaths = this.deduplicatePaths(paths);

        this.recipeCache.set(cacheKey, uniquePaths);
        return uniquePaths;
    }

    /**
     * Expand a set of ingredients to their raw materials.
     * Collapses intermediates when they share base materials.
     */
    private expandIngredients(
        ingredients: ItemStack[],
        remainingDepth: number
    ): MaterialPath[] {
        if (remainingDepth <= 0) return [];

        // Track all possible expansions
        const allExpansions: MaterialPath[][] = [];

        for (const ingredient of ingredients) {
            const recipes = this.getRecipesFor(ingredient.name);

            if (recipes.length === 0) {
                // No recipe - this is a raw material
                allExpansions.push([
                    {
                        items: [ingredient],
                        craftingSteps: 0,
                    },
                ]);
                continue;
            }

            // Get expansions for this ingredient
            const ingredientExpansions: MaterialPath[] = [];
            for (const recipe of recipes) {
                const recipeIngredients = this.extractIngredients(recipe);
                if (recipeIngredients.length === 0) continue;

                // Scale by needed count
                const outputCount = recipe.result.count;
                const craftCount = Math.ceil(ingredient.count / outputCount);
                const scaledIngredients = recipeIngredients.map((i) => ({
                    name: i.name,
                    count: i.count * craftCount,
                }));

                ingredientExpansions.push({
                    items: scaledIngredients,
                    craftingSteps: 1,
                });

                // Recurse if depth allows
                if (remainingDepth > 1) {
                    const deeper = this.expandIngredients(
                        scaledIngredients,
                        remainingDepth - 1
                    );
                    for (const d of deeper) {
                        ingredientExpansions.push({
                            items: d.items,
                            craftingSteps: d.craftingSteps + 1,
                        });
                    }
                }
            }

            if (ingredientExpansions.length > 0) {
                allExpansions.push(ingredientExpansions);
            } else {
                // No valid expansions, keep original
                allExpansions.push([
                    {
                        items: [ingredient],
                        craftingSteps: 0,
                    },
                ]);
            }
        }

        // Combine expansions: pick one path per ingredient and merge
        // For simplicity, just combine the first (simplest) option for each
        const result: MaterialPath[] = [];

        if (allExpansions.length === 0) return result;

        // Get all combinations (product)
        const combinations = this.cartesianProduct(allExpansions);

        for (const combo of combinations) {
            const merged = this.mergeItemStacks(combo.flatMap((p) => p.items));
            const maxSteps = Math.max(...combo.map((p) => p.craftingSteps));
            result.push({
                items: merged,
                craftingSteps: maxSteps,
            });
        }

        return result;
    }

    /**
     * Cartesian product of arrays (limited to prevent explosion).
     */
    private cartesianProduct<T>(arrays: T[][]): T[][] {
        if (arrays.length === 0) return [[]];
        if (arrays.length === 1) return arrays[0]!.map((item) => [item]);

        // Limit combinations to prevent explosion
        const maxCombinations = 10;
        let result: T[][] = [[]];

        for (const array of arrays) {
            const newResult: T[][] = [];
            for (const existing of result) {
                for (const item of array.slice(0, 3)) {
                    // Limit options per slot
                    newResult.push([...existing, item]);
                    if (newResult.length >= maxCombinations) break;
                }
                if (newResult.length >= maxCombinations) break;
            }
            result = newResult;
            if (result.length >= maxCombinations) break;
        }

        return result;
    }

    /**
     * Merge item stacks with the same name.
     */
    private mergeItemStacks(items: ItemStack[]): ItemStack[] {
        const counts = new Map<string, number>();
        for (const item of items) {
            counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
        }
        return Array.from(counts.entries()).map(([name, count]) => ({
            name,
            count,
        }));
    }

    /**
     * Remove duplicate material paths.
     */
    private deduplicatePaths(paths: MaterialPath[]): MaterialPath[] {
        const seen = new Set<string>();
        const unique: MaterialPath[] = [];

        for (const path of paths) {
            const key = path.items
                .map((i) => `${i.name}:${i.count}`)
                .sort()
                .join(',');
            const fullKey = `${key}|${path.craftingSteps}`;
            if (!seen.has(fullKey)) {
                seen.add(fullKey);
                unique.push(path);
            }
        }

        return unique;
    }

    /**
     * Check if inventory can satisfy a need category.
     * Returns the best offer that can be made.
     *
     * @param category - Item category like "hoe", "axe", "log"
     * @param inventory - Current inventory items
     * @param botName - Name to use in offer (optional)
     */
    whatCanSatisfy(
        category: string,
        inventory: ItemStack[],
        botName: string = ''
    ): SatisfactionResult {
        const targetItems = getItemsInCategory(category);

        // Check 1: Do we have any item in the category?
        const hasCategory = inventoryHasCategory(inventory, category);
        if (hasCategory.has && hasCategory.item) {
            return {
                canSatisfy: true,
                completeness: 100,
                bestOffer: {
                    from: botName,
                    type: 'item',
                    completeness: 'full',
                    items: [{ name: hasCategory.item, count: 1 }],
                    craftingSteps: 0,
                    timestamp: Date.now(),
                },
            };
        }

        // Check 2: Do we have materials for any variant?
        let bestMaterialOffer: NeedOffer | null = null;
        let bestCraftingSteps = Infinity;

        for (const targetItem of targetItems) {
            const paths = this.getMaterialPaths(targetItem);

            for (const path of paths) {
                if (path.craftingSteps === 0) continue; // Skip "item itself"

                if (this.inventoryHasAll(inventory, path.items)) {
                    if (path.craftingSteps < bestCraftingSteps) {
                        bestCraftingSteps = path.craftingSteps;
                        bestMaterialOffer = {
                            from: botName,
                            type: 'materials',
                            completeness: 'full',
                            items: path.items,
                            craftingSteps: path.craftingSteps,
                            timestamp: Date.now(),
                        };
                    }
                }
            }
        }

        if (bestMaterialOffer) {
            return {
                canSatisfy: true,
                completeness: 100,
                bestOffer: bestMaterialOffer,
            };
        }

        // Check 3: Partial satisfaction
        const partialOffer = this.findPartialSatisfaction(
            category,
            inventory,
            botName
        );
        if (partialOffer) {
            return {
                canSatisfy: true,
                completeness: partialOffer.completeness,
                bestOffer: partialOffer.offer,
            };
        }

        return { canSatisfy: false, completeness: 0, bestOffer: null };
    }

    /**
     * Check if inventory has all required items.
     */
    private inventoryHasAll(
        inventory: ItemStack[],
        required: ItemStack[]
    ): boolean {
        for (const req of required) {
            const has = inventory.find((i) => i.name === req.name);
            if (!has || has.count < req.count) return false;
        }
        return true;
    }

    /**
     * Find partial satisfaction for a need.
     * Returns the items we can provide that move toward the goal.
     */
    private findPartialSatisfaction(
        category: string,
        inventory: ItemStack[],
        botName: string
    ): { offer: NeedOffer; completeness: number } | null {
        const targetItems = getItemsInCategory(category);

        // Find the best partial match
        for (const targetItem of targetItems) {
            const paths = this.getMaterialPaths(targetItem);

            // Try each path and see what we can provide
            for (const path of paths) {
                if (path.craftingSteps === 0) continue;

                const available: ItemStack[] = [];
                let totalRequired = 0;
                let totalProvided = 0;

                for (const req of path.items) {
                    totalRequired += req.count;
                    const has = inventory.find((i) => i.name === req.name);
                    if (has && has.count > 0) {
                        const provide = Math.min(has.count, req.count);
                        available.push({ name: req.name, count: provide });
                        totalProvided += provide;
                    }
                }

                if (available.length > 0 && totalProvided > 0) {
                    const completeness = Math.round(
                        (totalProvided / totalRequired) * 100
                    );
                    return {
                        offer: {
                            from: botName,
                            type: 'materials',
                            completeness: 'partial',
                            items: available,
                            craftingSteps: path.craftingSteps,
                            timestamp: Date.now(),
                        },
                        completeness,
                    };
                }
            }
        }

        return null;
    }

    /**
     * Get the simplest recipe path for an item.
     * Useful for determining what raw materials are needed.
     */
    getSimplestPath(itemName: string): MaterialPath | null {
        const paths = this.getMaterialPaths(itemName);
        // Return the path with minimum crafting steps > 0 (not item itself)
        const craftPaths = paths.filter((p) => p.craftingSteps > 0);
        if (craftPaths.length === 0) return null;
        return craftPaths.reduce((a, b) =>
            a.craftingSteps <= b.craftingSteps ? a : b
        );
    }

    /**
     * Get the raw materials needed for an item (maximum depth expansion).
     */
    getRawMaterials(itemName: string): MaterialPath | null {
        const paths = this.getMaterialPaths(itemName, 3); // Deep expansion
        const craftPaths = paths.filter((p) => p.craftingSteps > 0);
        if (craftPaths.length === 0) return null;

        // Return path with maximum crafting steps (most expanded)
        return craftPaths.reduce((a, b) =>
            a.craftingSteps >= b.craftingSteps ? a : b
        );
    }

    /**
     * Clear the cache (for testing or version changes).
     */
    clearCache(): void {
        this.recipeCache.clear();
    }
}
