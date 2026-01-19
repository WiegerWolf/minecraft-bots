import { WorldState } from '../../../src/planning/WorldState';
import { Vec3Mock } from '../Vec3Mock';

/**
 * Type for WorldState fact values (matches the real type).
 */
export type FactValue = number | boolean | string | Vec3Mock | null;

/**
 * Create a WorldState with preset facts.
 */
export function createWorldState(facts: Record<string, FactValue> = {}): WorldState {
  const ws = new WorldState();
  for (const [key, value] of Object.entries(facts)) {
    ws.set(key, value as any);
  }
  return ws;
}
