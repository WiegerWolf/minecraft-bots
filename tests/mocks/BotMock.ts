import type { Bot } from 'mineflayer';
import { Vec3Mock, vec3 } from './Vec3Mock';

/**
 * Minimal Bot mock for testing GOAP planning.
 * Only implements what's needed for precondition/effect testing.
 */
export interface MockInventoryItem {
  name: string;
  count: number;
  type: number;
}

export interface BotMockConfig {
  position?: Vec3Mock;
  inventory?: MockInventoryItem[];
  health?: number;
  food?: number;
}

export function createBotMock(config: BotMockConfig = {}): Bot {
  const position = config.position ?? vec3(0, 64, 0);
  const inventory = config.inventory ?? [];

  const mockBot = {
    entity: {
      position,
      velocity: vec3(0, 0, 0),
      onGround: true,
    },
    health: config.health ?? 20,
    food: config.food ?? 20,
    inventory: {
      items: () => inventory,
      slots: new Array(36).fill(null),
      emptySlotCount: () => 36 - inventory.length,
    },
    // Pathfinder stubs
    pathfinder: {
      setGoal: () => {},
      goto: async () => {},
      setMovements: () => {},
      isMoving: () => false,
    },
    // Chat stub
    chat: (message: string) => {
      // Can be spied on in tests
    },
    // Event system stubs
    on: () => mockBot,
    once: () => mockBot,
    off: () => mockBot,
    emit: () => false,
    // Block interaction stubs
    dig: async () => {},
    placeBlock: async () => {},
    activateBlock: async () => {},
    // Look stubs
    lookAt: async () => {},
    look: async () => {},
    // Movement stubs
    setControlState: () => {},
    clearControlStates: () => {},
    // World stubs (minimal)
    blockAt: () => null,
    findBlocks: () => [],
    nearestEntity: () => null,
    // Username for chat filtering
    username: 'TestBot',
  } as unknown as Bot;

  return mockBot;
}

/**
 * Helper to create inventory items.
 */
export function item(name: string, count: number): MockInventoryItem {
  return { name, count, type: 0 };
}
