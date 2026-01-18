import { Vec3 } from 'vec3';

/**
 * Represents a fact about the world as a key-value pair.
 * Examples:
 * - 'inv.seeds': 15 (numeric)
 * - 'has.hoe': true (boolean)
 * - 'nearby.matureCrops': 12 (count from perception)
 * - 'pos.farmCenter': Vec3 (position)
 */
export type FactValue = number | boolean | string | Vec3 | null;

/**
 * WorldState stores facts about the current state of the world.
 * Used by the GOAP planner to reason about preconditions and effects.
 */
export class WorldState {
  private facts: Map<string, FactValue>;

  constructor(initialFacts?: Map<string, FactValue>) {
    this.facts = initialFacts ? new Map(initialFacts) : new Map();
  }

  /**
   * Get a fact value by key.
   */
  get(key: string): FactValue {
    return this.facts.get(key) ?? null;
  }

  /**
   * Get a fact value as a number (returns 0 if not a number).
   */
  getNumber(key: string): number {
    const value = this.get(key);
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Get a fact value as a boolean (returns false if not a boolean).
   */
  getBool(key: string): boolean {
    const value = this.get(key);
    return typeof value === 'boolean' ? value : false;
  }

  /**
   * Get a fact value as a Vec3 (returns null if not a Vec3).
   */
  getVec3(key: string): Vec3 | null {
    const value = this.get(key);
    return value instanceof Vec3 ? value : null;
  }

  /**
   * Get a fact value as a string (returns empty string if not a string).
   */
  getString(key: string): string {
    const value = this.get(key);
    return typeof value === 'string' ? value : '';
  }

  /**
   * Set a fact value.
   */
  set(key: string, value: FactValue): void {
    this.facts.set(key, value);
  }

  /**
   * Check if a fact exists.
   */
  has(key: string): boolean {
    return this.facts.has(key);
  }

  /**
   * Delete a fact.
   */
  delete(key: string): void {
    this.facts.delete(key);
  }

  /**
   * Create a deep copy of this WorldState.
   */
  clone(): WorldState {
    const clonedFacts = new Map<string, FactValue>();
    for (const [key, value] of this.facts.entries()) {
      // Deep copy Vec3 objects
      if (value instanceof Vec3) {
        clonedFacts.set(key, value.clone());
      } else {
        clonedFacts.set(key, value);
      }
    }
    return new WorldState(clonedFacts);
  }

  /**
   * Get all fact keys.
   */
  keys(): string[] {
    return Array.from(this.facts.keys());
  }

  /**
   * Get all fact entries.
   */
  entries(): [string, FactValue][] {
    return Array.from(this.facts.entries());
  }

  /**
   * Check if this state satisfies a set of conditions.
   */
  satisfies(conditions: Map<string, (value: FactValue) => boolean>): boolean {
    for (const [key, check] of conditions.entries()) {
      const value = this.get(key);
      if (!check(value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Calculate the difference between this state and another state.
   * Returns the number of facts that differ.
   */
  diff(other: WorldState): number {
    let differences = 0;
    const allKeys = new Set([...this.keys(), ...other.keys()]);

    for (const key of allKeys) {
      const thisValue = this.get(key);
      const otherValue = other.get(key);

      // Handle Vec3 comparison
      if (thisValue instanceof Vec3 && otherValue instanceof Vec3) {
        if (!thisValue.equals(otherValue)) {
          differences++;
        }
      } else if (thisValue !== otherValue) {
        differences++;
      }
    }

    return differences;
  }

  /**
   * Get a human-readable string representation of the state.
   */
  toString(): string {
    const entries = this.entries()
      .map(([key, value]) => {
        if (value instanceof Vec3) {
          return `${key}: (${value.x}, ${value.y}, ${value.z})`;
        }
        return `${key}: ${value}`;
      })
      .join(', ');
    return `WorldState{${entries}}`;
  }
}
