/**
 * Type augmentation for baritone-ts pathfinder extension of mineflayer Bot
 */

import type { Goal, CalculationContext } from 'baritone-ts';

declare module 'mineflayer' {
  interface Bot {
    pathfinder: {
      goto(goal: Goal): Promise<void>;
      stop(): void;
      isMoving(): boolean;
      ctx: CalculationContext;
    };
  }
}
