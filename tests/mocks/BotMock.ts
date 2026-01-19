import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { Vec3Mock, vec3 } from './Vec3Mock';
import { MockWorld, type MockBlock } from './MockWorld';

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
  world?: MockWorld;
}

export function createBotMock(config: BotMockConfig = {}): Bot {
  const position = config.position ?? vec3(0, 64, 0);
  const inventory = config.inventory ?? [];
  const world = config.world ?? null;

  const mockBot = {
    entity: {
      position,
      velocity: vec3(0, 0, 0),
      onGround: true,
    },
    entities: {} as Record<string, any>, // Empty entities for drops
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
    // World access - uses MockWorld if provided
    blockAt: (pos: Vec3Mock) => {
      if (!world) return null;
      const block = world.blockAt(pos as unknown as Vec3);
      if (!block) return null;
      // Return a mock Block object matching mineflayer's interface
      return {
        name: block.name,
        position: block.position,
        type: block.type ?? 0,
        metadata: block.metadata ?? 0,
        signText: block.signText,
        transparent: block.transparent ?? false,
      };
    },
    findBlocks: (options: {
      point?: Vec3Mock;
      maxDistance: number;
      count: number;
      matching: (block: any) => boolean;
    }) => {
      if (!world) return [];
      const point = options.point ?? position;
      return world.findBlocks({
        point: point as unknown as Vec3,
        maxDistance: options.maxDistance,
        count: options.count,
        matching: options.matching,
      });
    },
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
