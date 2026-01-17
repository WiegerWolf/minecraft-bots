import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { Logger } from './logger';

/**
 * Sign-based persistent knowledge system.
 *
 * Uses Minecraft signs placed near spawn as a "persistent memory" that survives
 * bot disconnects and deaths. When bots establish infrastructure (crafting tables,
 * chests, village center), they write the coordinates to signs. On respawn,
 * bots read these signs to recover knowledge.
 *
 * Sign text format (4 lines, ~15 chars each):
 * Line 1: [TYPE]
 * Line 2: X: <number>
 * Line 3: Y: <number>
 * Line 4: Z: <number>
 *
 * Sign types:
 * - VILLAGE: Village center position
 * - CRAFT: Shared crafting table position
 * - CHEST: Shared chest position
 */

export type SignKnowledgeType = 'VILLAGE' | 'CRAFT' | 'CHEST';

export interface KnowledgeEntry {
    type: SignKnowledgeType;
    pos: Vec3;
}

/**
 * Format sign text for a knowledge entry.
 * Returns an array of 4 lines for the sign.
 */
export function formatSignText(type: SignKnowledgeType, pos: Vec3): string[] {
    return [
        `[${type}]`,
        `X: ${Math.floor(pos.x)}`,
        `Y: ${Math.floor(pos.y)}`,
        `Z: ${Math.floor(pos.z)}`
    ];
}

/**
 * Parse sign text back to a knowledge entry.
 * Returns null if the sign doesn't contain valid knowledge.
 */
export function parseSignText(lines: string[]): KnowledgeEntry | null {
    if (!lines || lines.length < 4) return null;

    // Check first line for [TYPE] format
    const typeMatch = lines[0]?.match(/^\[(VILLAGE|CRAFT|CHEST)\]$/);
    if (!typeMatch) return null;

    const type = typeMatch[1] as SignKnowledgeType;

    // Parse coordinates
    const xMatch = lines[1]?.match(/^X:\s*(-?\d+)$/);
    const yMatch = lines[2]?.match(/^Y:\s*(-?\d+)$/);
    const zMatch = lines[3]?.match(/^Z:\s*(-?\d+)$/);

    if (!xMatch || !yMatch || !zMatch) return null;

    const x = parseInt(xMatch[1]!, 10);
    const y = parseInt(yMatch[1]!, 10);
    const z = parseInt(zMatch[1]!, 10);

    return {
        type,
        pos: new Vec3(x, y, z)
    };
}

/**
 * Find all signs within a radius of a position.
 */
export function findSignsNear(bot: Bot, center: Vec3, radius: number = 10): Block[] {
    const signBlocks = bot.findBlocks({
        point: center,
        maxDistance: radius,
        count: 20,
        matching: (block) => {
            if (!block || !block.name) return false;
            // Match all sign types: oak_sign, spruce_sign, etc. (both wall and standing)
            return block.name.includes('_sign');
        }
    });

    return signBlocks
        .map(pos => bot.blockAt(pos))
        .filter((b): b is Block => b !== null);
}

/**
 * Read sign text from a sign block.
 * Returns the front text as an array of 4 lines.
 */
export function readSignText(block: Block): string[] {
    try {
        // mineflayer provides getSignText() which returns [frontText, backText]
        // Each is a string with lines separated by \n
        const signText = (block as any).getSignText?.();
        if (!signText || !signText[0]) return [];

        // Split front text into lines
        const lines = signText[0].split('\n');
        return lines;
    } catch {
        return [];
    }
}

/**
 * Read all knowledge signs near spawn position.
 * Returns a map of type -> position.
 */
export function readSignsAtSpawn(
    bot: Bot,
    spawnPos: Vec3,
    log?: Logger | null
): Map<SignKnowledgeType, Vec3> {
    const knowledge = new Map<SignKnowledgeType, Vec3>();

    const signs = findSignsNear(bot, spawnPos, 15);
    log?.debug({ signCount: signs.length, spawnPos: spawnPos.toString() }, 'Found signs near spawn');

    for (const sign of signs) {
        const lines = readSignText(sign);
        const entry = parseSignText(lines);

        if (entry) {
            knowledge.set(entry.type, entry.pos);
            log?.info(
                { type: entry.type, pos: entry.pos.toString(), signPos: sign.position.toString() },
                'Read knowledge from sign'
            );
        }
    }

    return knowledge;
}

/**
 * Calculate sign placement positions near spawn.
 * Returns positions in a grid pattern offset from spawn.
 */
export function getSignPlacementPositions(spawnPos: Vec3): Vec3[] {
    // Place signs in a 2x3 grid, offset +2 X from spawn
    const baseX = spawnPos.x + 2;
    const baseY = spawnPos.y;
    const baseZ = spawnPos.z - 1;

    return [
        new Vec3(baseX, baseY, baseZ),      // VILLAGE sign
        new Vec3(baseX, baseY, baseZ + 1),  // CRAFT sign
        new Vec3(baseX, baseY, baseZ + 2),  // CHEST sign
        new Vec3(baseX + 1, baseY, baseZ),      // Extra slot 1
        new Vec3(baseX + 1, baseY, baseZ + 1),  // Extra slot 2
        new Vec3(baseX + 1, baseY, baseZ + 2),  // Extra slot 3
    ];
}

/**
 * Get the preferred position for a sign type.
 */
export function getSignPositionForType(spawnPos: Vec3, type: SignKnowledgeType): Vec3 {
    const positions = getSignPlacementPositions(spawnPos);
    switch (type) {
        case 'VILLAGE': return positions[0]!;
        case 'CRAFT': return positions[1]!;
        case 'CHEST': return positions[2]!;
    }
}

/**
 * Check if the bot has or can craft a sign.
 */
export function hasOrCanCraftSign(bot: Bot): boolean {
    // Check inventory for any sign
    const hasSign = bot.inventory.items().some(i => i.name.includes('_sign'));
    if (hasSign) return true;

    // Check if can craft: 6 planks + 1 stick = 3 signs
    const planks = bot.inventory.items()
        .filter(i => i.name.endsWith('_planks'))
        .reduce((sum, i) => sum + i.count, 0);
    const sticks = bot.inventory.items()
        .filter(i => i.name === 'stick')
        .reduce((sum, i) => sum + i.count, 0);

    return planks >= 6 && sticks >= 1;
}

/**
 * Get the count of signs in inventory.
 */
export function getSignCount(bot: Bot): number {
    return bot.inventory.items()
        .filter(i => i.name.includes('_sign'))
        .reduce((sum, i) => sum + i.count, 0);
}

/**
 * Find an existing sign with a specific knowledge type.
 * Used to update signs instead of placing new ones.
 */
export function findExistingSignForType(
    bot: Bot,
    spawnPos: Vec3,
    type: SignKnowledgeType
): Block | null {
    const signs = findSignsNear(bot, spawnPos, 15);

    for (const sign of signs) {
        const lines = readSignText(sign);
        const entry = parseSignText(lines);
        if (entry && entry.type === type) {
            return sign;
        }
    }

    return null;
}
