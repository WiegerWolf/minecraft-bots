/**
 * Terrain Utilities - Shared helpers for terrain analysis
 *
 * Used by all bot roles to make smart decisions about where to explore.
 */

import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/**
 * Blocks that can be cleared by bots (trees, vegetation) - don't count as blocking sky
 */
const CLEARABLE_SKY_BLOCKS = new Set([
    // Tree parts (can be chopped)
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
    // Saplings
    'oak_sapling', 'birch_sapling', 'spruce_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'mangrove_propagule', 'cherry_sapling',
]);

/**
 * Check if a single column has clear sky above it.
 * Used internally by hasClearSky.
 */
function checkColumnClear(bot: Bot, x: number, z: number, startY: number, maxY: number): boolean {
    // Check upward for any solid blocks
    for (let y = startY; y < Math.min(maxY, startY + 64); y++) {
        const block = bot.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)));
        if (!block) continue; // Unloaded chunk, assume clear

        // Air and transparent blocks are OK
        if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue;
        if (block.transparent) continue;

        // Trees and clearable blocks are OK (bot can remove them)
        if (block.name.includes('leaves')) continue;
        if (block.name.includes('log')) continue;
        if (CLEARABLE_SKY_BLOCKS.has(block.name)) continue;

        // Found a solid block above - not clear sky
        return false;
    }
    return true;
}

/**
 * Check if a position has clear sky above it (no solid blocks like stone, dirt).
 * Trees and vegetation are ignored since bots can clear them.
 *
 * This is used to prevent bots from exploring into caves.
 *
 * @param bot - The bot instance
 * @param pos - Position to check
 * @param checkRadius - If > 0, also checks surrounding positions at this radius
 * @returns true if sky is clear above
 */
export function hasClearSky(bot: Bot, pos: Vec3, checkRadius: number = 0): boolean {
    const worldHeight = 320; // Max world height in modern MC
    const startY = Math.floor(pos.y) + 1;

    // Check the main position
    if (!checkColumnClear(bot, pos.x, pos.z, startY, worldHeight)) {
        return false;
    }

    // If radius specified, check surrounding positions too
    if (checkRadius > 0) {
        const offsets: [number, number][] = [
            [checkRadius, 0], [-checkRadius, 0],
            [0, checkRadius], [0, -checkRadius]
        ];
        for (const [dx, dz] of offsets) {
            if (!checkColumnClear(bot, pos.x + dx, pos.z + dz, startY, worldHeight)) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Minimum Y level for safe exploration.
 * Below this is considered underground (ravines, caves).
 */
export const MIN_SAFE_EXPLORATION_Y = 55;

/**
 * Maximum Y level for efficient exploration.
 * Above this is mountains, less useful for farming/logging.
 */
export const MAX_SAFE_EXPLORATION_Y = 85;

/**
 * Check if a Y level is within safe exploration bounds.
 * @param y - The Y coordinate to check
 * @returns true if within safe bounds
 */
export function isYLevelSafe(y: number): boolean {
    return y >= MIN_SAFE_EXPLORATION_Y && y <= MAX_SAFE_EXPLORATION_Y;
}

/**
 * Score penalty for positions without clear sky.
 * This is very high to strongly discourage cave exploration.
 */
export const NO_SKY_PENALTY = -200;

/**
 * Score penalty for positions at unsafe Y levels.
 */
export const UNSAFE_Y_PENALTY = -100;
