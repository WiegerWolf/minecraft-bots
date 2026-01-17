export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a pathfinder "goal changed" error.
 * This happens when a new goal interrupts an existing pathfinding operation.
 */
export function isGoalChangedError(err: unknown): boolean {
    if (err instanceof Error) {
        return err.message.includes('goal was changed') || err.name === 'GoalChanged';
    }
    return false;
}

/**
 * Wrapper for bot.pathfinder.goto() that adds timeout functionality.
 * If pathfinding doesn't complete within the specified time, it will be canceled.
 */
export async function pathfinderGotoWithTimeout(
    bot: any,
    goal: any,
    timeoutMs: number = 5000 // Default 5 seconds
): Promise<void> {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            bot.pathfinder.stop();
            reject(new Error(`Pathfinding timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    const pathfindingPromise = bot.pathfinder.goto(goal);

    return Promise.race([pathfindingPromise, timeoutPromise]);
}

/**
 * Attempts to clear a path by breaking nearby blocks that might be obstructing the bot.
 */
export async function clearPath(bot: any): Promise<void> {
    // Check for blocks around the bot that might be obstructing movement
    const searchPositions = [
        { x: 0, y: 0, z: 1 },  // Front
        { x: 0, y: 1, z: 1 },  // Front upper
        { x: 1, y: 0, z: 0 },  // Right
        { x: 1, y: 1, z: 0 },  // Right upper
        { x: 0, y: 0, z: -1 }, // Back
        { x: 0, y: 1, z: -1 }, // Back upper
        { x: -1, y: 0, z: 0 }, // Left
        { x: -1, y: 1, z: 0 }, // Left upper
        { x: 0, y: 2, z: 0 },  // Above
    ];

    for (const offset of searchPositions) {
        const blockPos = bot.entity.position.offset(offset.x, offset.y, offset.z).floored();
        const block = bot.blockAt(blockPos);

        if (block && block.boundingBox === 'block' && block.name !== 'air') {
            try {
                // Only break blocks that are not too hard (avoid breaking stone, etc.)
                const breakableBlocks = ['dirt', 'grass', 'sand', 'gravel', 'wood', 'leaves'];
                if (breakableBlocks.some(type => block.name.includes(type))) {
                    await bot.dig(block);
                    await sleep(200);
                }
            } catch {
                // Ignore break failures
            }
        }
    }
}

/**
 * Check if an error is a pathfinder timeout error.
 */
export function isPathfinderTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
        return err.message.includes('Pathfinding timed out');
    }
    return false;
}

/**
 * Wrapper for pathfinding with retry logic and path clearing on timeout.
 */
export async function pathfinderGotoWithRetry(
    bot: any,
    goal: any,
    maxRetries: number = 2,
    timeoutMs: number = 5000
): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await pathfinderGotoWithTimeout(bot, goal, timeoutMs);
            return true; // Success
        } catch (err) {
            // If this was a timeout, try to clear path before retrying
            if (isPathfinderTimeoutError(err) && attempt < maxRetries) {
                await clearPath(bot);
                await sleep(1000); // Wait for dust to settle
            }

            // If we've reached max retries, give up
            if (attempt === maxRetries) {
                return false;
            }
        }
    }
    return false; // Should never reach here
}
