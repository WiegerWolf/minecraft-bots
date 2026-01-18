/**
 * Item categorization for the trading system.
 *
 * Each role has:
 * - WANTED items: Resources the role keeps for itself
 * - HELPFUL items: Resources the role picks up to help OTHER roles
 *
 * Items not in either list for a role are considered "unwanted" and
 * will be offered for trade.
 */

export type RoleName = 'farmer' | 'lumberjack' | 'landscaper';

/**
 * Items each role WANTS (keeps for itself).
 * Pattern matching: use '*' prefix/suffix for wildcard matching.
 */
const WANTED_ITEMS: Record<RoleName, string[]> = {
    farmer: [
        // Seeds (all types)
        '*_seeds',
        // Crops/produce
        'wheat', 'carrot', 'potato', 'beetroot', 'melon_slice',
        // Tools
        '*_hoe',
        // Crafting materials (for hoe)
        '*_log', '*_planks', 'stick',
    ],
    lumberjack: [
        // Wood products
        '*_log', '*_planks', 'stick',
        // Saplings (for replanting)
        '*_sapling',
        // Tools
        '*_axe',
    ],
    landscaper: [
        // Building/terraforming materials
        'dirt', 'cobblestone', 'stone', 'gravel', 'sand',
        'diorite', 'andesite', 'granite',
        'polished_diorite', 'polished_andesite', 'polished_granite',
        // Navigation scaffolding
        '*_planks', '*_slab',
        // Tools
        '*_shovel', '*_pickaxe',
        // Crafting
        'stick',
    ],
};

/**
 * Items each role will HELP GATHER for others.
 * These items are picked up even though the role doesn't need them,
 * specifically to offer them for trade.
 */
const HELPFUL_ITEMS: Record<RoleName, string[]> = {
    farmer: [
        // Help landscaper by picking up dirt/cobble
        'dirt', 'cobblestone', 'gravel', 'sand',
    ],
    lumberjack: [
        // Help farmer by picking up seeds/crops
        '*_seeds', 'wheat', 'carrot', 'potato', 'beetroot',
    ],
    landscaper: [
        // Help lumberjack by picking up saplings and logs
        '*_sapling', '*_log',
    ],
};

/**
 * Check if an item name matches a pattern.
 * Patterns can use '*' as a wildcard prefix or suffix.
 *
 * Examples:
 * - 'wheat_seeds' matches '*_seeds'
 * - 'oak_log' matches '*_log'
 * - 'stone_shovel' matches '*_shovel'
 */
function matchesPattern(itemName: string, pattern: string): boolean {
    if (pattern.startsWith('*')) {
        // Suffix match: '*_seeds' matches 'wheat_seeds'
        return itemName.endsWith(pattern.slice(1));
    }
    if (pattern.endsWith('*')) {
        // Prefix match: 'stone_*' matches 'stone_brick'
        return itemName.startsWith(pattern.slice(0, -1));
    }
    // Exact match
    return itemName === pattern;
}

/**
 * Check if an item is wanted by a specific role.
 */
export function isWantedByRole(itemName: string, role: RoleName): boolean {
    const patterns = WANTED_ITEMS[role];
    return patterns.some(pattern => matchesPattern(itemName, pattern));
}

/**
 * Check if an item is helpful to gather for other roles.
 */
export function isHelpfulItem(itemName: string, role: RoleName): boolean {
    const patterns = HELPFUL_ITEMS[role];
    return patterns.some(pattern => matchesPattern(itemName, pattern));
}

/**
 * Check if an item should be picked up by a role.
 * This includes both wanted items AND helpful items for others.
 */
export function shouldPickUp(itemName: string, role: RoleName): boolean {
    return isWantedByRole(itemName, role) || isHelpfulItem(itemName, role);
}

/**
 * Check if an item is unwanted by a role (not wanted AND not helpful).
 * These items are candidates for trading away.
 */
export function isUnwantedByRole(itemName: string, role: RoleName): boolean {
    return !isWantedByRole(itemName, role) && !isHelpfulItem(itemName, role);
}

/**
 * Inventory item interface (minimal for our needs).
 */
export interface InventoryItem {
    name: string;
    count: number;
}

/**
 * Get items from inventory that the role doesn't want.
 * Returns items grouped by name with total counts.
 */
export function getUnwantedItems(inventory: InventoryItem[], role: RoleName): InventoryItem[] {
    const unwantedMap = new Map<string, number>();

    for (const item of inventory) {
        if (isUnwantedByRole(item.name, role)) {
            const current = unwantedMap.get(item.name) || 0;
            unwantedMap.set(item.name, current + item.count);
        }
    }

    return Array.from(unwantedMap.entries()).map(([name, count]) => ({ name, count }));
}

/**
 * Get items from inventory that are helpful (for trading to others).
 */
export function getHelpfulItemsInInventory(inventory: InventoryItem[], role: RoleName): InventoryItem[] {
    const helpfulMap = new Map<string, number>();

    for (const item of inventory) {
        // Only include items that are helpful but NOT wanted by self
        if (isHelpfulItem(item.name, role) && !isWantedByRole(item.name, role)) {
            const current = helpfulMap.get(item.name) || 0;
            helpfulMap.set(item.name, current + item.count);
        }
    }

    return Array.from(helpfulMap.entries()).map(([name, count]) => ({ name, count }));
}

/**
 * Get the total count of unwanted items in inventory.
 */
export function getUnwantedItemCount(inventory: InventoryItem[], role: RoleName): number {
    let count = 0;
    for (const item of inventory) {
        if (isUnwantedByRole(item.name, role)) {
            count += item.count;
        }
    }
    return count;
}

/**
 * Get the total count of helpful items in inventory (for trading).
 */
export function getHelpfulItemCount(inventory: InventoryItem[], role: RoleName): number {
    let count = 0;
    for (const item of inventory) {
        if (isHelpfulItem(item.name, role) && !isWantedByRole(item.name, role)) {
            count += item.count;
        }
    }
    return count;
}

/**
 * Get items that can be offered for trade (unwanted + helpful for others).
 * Items are sorted by count (highest first).
 */
export function getTradeableItems(inventory: InventoryItem[], role: RoleName): InventoryItem[] {
    const tradeableMap = new Map<string, number>();

    for (const item of inventory) {
        // Unwanted items (neither wanted nor helpful)
        if (isUnwantedByRole(item.name, role)) {
            const current = tradeableMap.get(item.name) || 0;
            tradeableMap.set(item.name, current + item.count);
        }
        // Helpful items (picked up for others)
        else if (isHelpfulItem(item.name, role) && !isWantedByRole(item.name, role)) {
            const current = tradeableMap.get(item.name) || 0;
            tradeableMap.set(item.name, current + item.count);
        }
    }

    return Array.from(tradeableMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Check which role wants a specific item.
 * Returns the first role that wants the item, or null if no one wants it.
 */
export function whoWantsItem(itemName: string): RoleName | null {
    const roles: RoleName[] = ['farmer', 'lumberjack', 'landscaper'];
    for (const role of roles) {
        if (isWantedByRole(itemName, role)) {
            return role;
        }
    }
    return null;
}

/**
 * Get the count of a specific item in inventory.
 */
export function getItemCount(inventory: InventoryItem[], itemName: string): number {
    let count = 0;
    for (const item of inventory) {
        if (item.name === itemName) {
            count += item.count;
        }
    }
    return count;
}
