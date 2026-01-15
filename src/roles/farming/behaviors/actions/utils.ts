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
