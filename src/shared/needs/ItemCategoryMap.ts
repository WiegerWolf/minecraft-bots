/**
 * Item Category Mappings
 *
 * Maps abstract categories (e.g., "hoe") to specific Minecraft item names.
 * This allows bots to express needs at a higher level of abstraction,
 * and accept any item that satisfies the category.
 */

/**
 * Map of category names to arrays of specific item names.
 * Items are ordered by preference (best first, typically by material tier).
 */
export const ITEM_CATEGORIES: Record<string, string[]> = {
    // Tools - ordered by durability (worst to best for easy access)
    hoe: [
        'wooden_hoe',
        'stone_hoe',
        'iron_hoe',
        'golden_hoe',
        'diamond_hoe',
        'netherite_hoe',
    ],
    axe: [
        'wooden_axe',
        'stone_axe',
        'iron_axe',
        'golden_axe',
        'diamond_axe',
        'netherite_axe',
    ],
    pickaxe: [
        'wooden_pickaxe',
        'stone_pickaxe',
        'iron_pickaxe',
        'golden_pickaxe',
        'diamond_pickaxe',
        'netherite_pickaxe',
    ],
    shovel: [
        'wooden_shovel',
        'stone_shovel',
        'iron_shovel',
        'golden_shovel',
        'diamond_shovel',
        'netherite_shovel',
    ],
    sword: [
        'wooden_sword',
        'stone_sword',
        'iron_sword',
        'golden_sword',
        'diamond_sword',
        'netherite_sword',
    ],

    // Wood types - any log satisfies "log" need
    log: [
        'oak_log',
        'spruce_log',
        'birch_log',
        'jungle_log',
        'acacia_log',
        'dark_oak_log',
        'cherry_log',
        'mangrove_log',
        'crimson_stem',
        'warped_stem',
    ],
    planks: [
        'oak_planks',
        'spruce_planks',
        'birch_planks',
        'jungle_planks',
        'acacia_planks',
        'dark_oak_planks',
        'cherry_planks',
        'mangrove_planks',
        'bamboo_planks',
        'crimson_planks',
        'warped_planks',
    ],
    sapling: [
        'oak_sapling',
        'spruce_sapling',
        'birch_sapling',
        'jungle_sapling',
        'acacia_sapling',
        'dark_oak_sapling',
        'cherry_sapling',
        'mangrove_propagule',
    ],

    // Basic materials
    stick: ['stick'],
    cobblestone: ['cobblestone'],
    stone: ['stone'],
    dirt: ['dirt'],
    gravel: ['gravel'],
    sand: ['sand'],

    // Seeds - any seed type
    seeds: [
        'wheat_seeds',
        'beetroot_seeds',
        'melon_seeds',
        'pumpkin_seeds',
        'torchflower_seeds',
        'pitcher_pod',
    ],

    // Crops/Produce
    wheat: ['wheat'],
    carrot: ['carrot'],
    potato: ['potato'],
    beetroot: ['beetroot'],
    melon: ['melon_slice', 'melon'],
    pumpkin: ['pumpkin'],

    // Building materials
    slab: [
        'oak_slab',
        'spruce_slab',
        'birch_slab',
        'jungle_slab',
        'acacia_slab',
        'dark_oak_slab',
        'stone_slab',
        'cobblestone_slab',
    ],

    // Ores and ingots
    coal: ['coal'],
    iron_ingot: ['iron_ingot'],
    gold_ingot: ['gold_ingot'],
    diamond: ['diamond'],
    iron_ore: ['iron_ore', 'deepslate_iron_ore'],
    gold_ore: ['gold_ore', 'deepslate_gold_ore'],

    // Boat category
    boat: [
        'oak_boat',
        'spruce_boat',
        'birch_boat',
        'jungle_boat',
        'acacia_boat',
        'dark_oak_boat',
        'cherry_boat',
        'mangrove_boat',
    ],
};

/**
 * Reverse lookup: item name → category.
 * Built once at module load.
 */
const ITEM_TO_CATEGORY: Map<string, string> = new Map();
for (const [category, items] of Object.entries(ITEM_CATEGORIES)) {
    for (const item of items) {
        ITEM_TO_CATEGORY.set(item, category);
    }
}

/**
 * Get all specific item names in a category.
 * If the category is not found, returns the category itself as a single-item array
 * (allowing specific item names to be used directly).
 */
export function getItemsInCategory(category: string): string[] {
    return ITEM_CATEGORIES[category] ?? [category];
}

/**
 * Get the category for a specific item name.
 * Returns null if the item is not in any known category.
 */
export function getCategoryForItem(item: string): string | null {
    return ITEM_TO_CATEGORY.get(item) ?? null;
}

/**
 * Check if an item belongs to a category.
 */
export function itemMatchesCategory(item: string, category: string): boolean {
    const items = ITEM_CATEGORIES[category];
    if (items) {
        return items.includes(item);
    }
    // If no category defined, exact match only
    return item === category;
}

/**
 * Check if inventory contains any item from a category.
 */
export function inventoryHasCategory(
    inventory: { name: string; count: number }[],
    category: string,
    minCount: number = 1
): { has: boolean; item: string | null; count: number } {
    const items = getItemsInCategory(category);
    for (const itemName of items) {
        const found = inventory.find((i) => i.name === itemName);
        if (found && found.count >= minCount) {
            return { has: true, item: found.name, count: found.count };
        }
    }
    return { has: false, item: null, count: 0 };
}

/**
 * Get all categories that contain a given item.
 * (An item might belong to multiple categories in theory)
 */
export function getAllCategoriesForItem(item: string): string[] {
    const categories: string[] = [];
    for (const [category, items] of Object.entries(ITEM_CATEGORIES)) {
        if (items.includes(item)) {
            categories.push(category);
        }
    }
    return categories;
}

/**
 * Get the "best" (highest tier) item in a category that's available in inventory.
 */
export function getBestAvailableInCategory(
    inventory: { name: string; count: number }[],
    category: string
): { item: string; count: number } | null {
    const items = getItemsInCategory(category);
    // Items are ordered worst-to-best, so iterate in reverse
    for (let i = items.length - 1; i >= 0; i--) {
        const itemName = items[i];
        const found = inventory.find((inv) => inv.name === itemName);
        if (found && found.count > 0) {
            return { item: found.name, count: found.count };
        }
    }
    return null;
}

/**
 * Get all available items from a category in inventory.
 */
export function getAllAvailableInCategory(
    inventory: { name: string; count: number }[],
    category: string
): { name: string; count: number }[] {
    const items = getItemsInCategory(category);
    return inventory.filter((inv) => items.includes(inv.name) && inv.count > 0);
}
