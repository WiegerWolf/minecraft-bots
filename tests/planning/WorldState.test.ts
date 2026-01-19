import { describe, test, expect } from 'bun:test';
import { WorldState } from '../../src/planning/WorldState';
import { Vec3 } from 'vec3';

describe('WorldState', () => {
  describe('basic operations', () => {
    test('get returns null for missing keys', () => {
      const ws = new WorldState();
      expect(ws.get('nonexistent')).toBeNull();
    });

    test('set and get work for numbers', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 42);
      expect(ws.get('inv.seeds')).toBe(42);
    });

    test('set and get work for booleans', () => {
      const ws = new WorldState();
      ws.set('has.hoe', true);
      expect(ws.get('has.hoe')).toBe(true);
    });

    test('set and get work for strings', () => {
      const ws = new WorldState();
      ws.set('state.action', 'harvesting');
      expect(ws.get('state.action')).toBe('harvesting');
    });

    test('set and get work for Vec3', () => {
      const ws = new WorldState();
      const pos = new Vec3(100, 64, 200);
      ws.set('pos.farmCenter', pos);
      expect(ws.get('pos.farmCenter')).toEqual(pos);
    });
  });

  describe('type-safe getters', () => {
    test('getNumber returns 0 for non-numbers', () => {
      const ws = new WorldState();
      ws.set('has.hoe', true);
      expect(ws.getNumber('has.hoe')).toBe(0);
      expect(ws.getNumber('nonexistent')).toBe(0);
    });

    test('getBool returns false for non-booleans', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 42);
      expect(ws.getBool('inv.seeds')).toBe(false);
      expect(ws.getBool('nonexistent')).toBe(false);
    });

    test('getString returns empty string for non-strings', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 42);
      expect(ws.getString('inv.seeds')).toBe('');
      expect(ws.getString('nonexistent')).toBe('');
    });

    test('getVec3 returns null for non-Vec3', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 42);
      expect(ws.getVec3('inv.seeds')).toBeNull();
      expect(ws.getVec3('nonexistent')).toBeNull();
    });
  });

  describe('clone', () => {
    test('creates independent copy', () => {
      const ws1 = new WorldState();
      ws1.set('inv.seeds', 10);
      ws1.set('has.hoe', true);

      const ws2 = ws1.clone();
      ws2.set('inv.seeds', 20);
      ws2.set('has.hoe', false);

      // Original unchanged
      expect(ws1.get('inv.seeds')).toBe(10);
      expect(ws1.get('has.hoe')).toBe(true);

      // Clone has new values
      expect(ws2.get('inv.seeds')).toBe(20);
      expect(ws2.get('has.hoe')).toBe(false);
    });

    test('deep copies Vec3 objects', () => {
      const ws1 = new WorldState();
      const pos = new Vec3(100, 64, 200);
      ws1.set('pos.farmCenter', pos);

      const ws2 = ws1.clone();

      // Modify original position
      pos.x = 999;

      // Clone should have independent copy
      const clonedPos = ws2.getVec3('pos.farmCenter');
      expect(clonedPos?.x).toBe(100); // Not 999
    });
  });

  describe('diff', () => {
    test('returns 0 for identical states', () => {
      const ws1 = new WorldState();
      ws1.set('inv.seeds', 10);
      ws1.set('has.hoe', true);

      const ws2 = ws1.clone();

      expect(ws1.diff(ws2)).toBe(0);
    });

    test('counts different values', () => {
      const ws1 = new WorldState();
      ws1.set('inv.seeds', 10);
      ws1.set('has.hoe', true);
      ws1.set('inv.produce', 5);

      const ws2 = new WorldState();
      ws2.set('inv.seeds', 20); // Different
      ws2.set('has.hoe', true); // Same
      ws2.set('inv.produce', 5); // Same

      expect(ws1.diff(ws2)).toBe(1);
    });

    test('counts missing keys as differences', () => {
      const ws1 = new WorldState();
      ws1.set('inv.seeds', 10);
      ws1.set('has.hoe', true);

      const ws2 = new WorldState();
      ws2.set('inv.seeds', 10);
      // has.hoe missing

      expect(ws1.diff(ws2)).toBe(1);
    });

    test('compares Vec3 by value not reference', () => {
      const ws1 = new WorldState();
      ws1.set('pos.farmCenter', new Vec3(100, 64, 200));

      const ws2 = new WorldState();
      ws2.set('pos.farmCenter', new Vec3(100, 64, 200)); // Same coordinates

      expect(ws1.diff(ws2)).toBe(0);

      ws2.set('pos.farmCenter', new Vec3(100, 64, 201)); // Different Z
      expect(ws1.diff(ws2)).toBe(1);
    });
  });

  describe('satisfies', () => {
    test('returns true when all conditions pass', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 15);
      ws.set('has.hoe', true);

      const conditions = new Map([
        ['inv.seeds', (v: any) => typeof v === 'number' && v >= 10],
        ['has.hoe', (v: any) => v === true],
      ]);

      expect(ws.satisfies(conditions)).toBe(true);
    });

    test('returns false when any condition fails', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 5); // Below threshold
      ws.set('has.hoe', true);

      const conditions = new Map([
        ['inv.seeds', (v: any) => typeof v === 'number' && v >= 10],
        ['has.hoe', (v: any) => v === true],
      ]);

      expect(ws.satisfies(conditions)).toBe(false);
    });

    test('handles missing keys (null values)', () => {
      const ws = new WorldState();
      // inv.seeds not set

      const conditions = new Map([
        ['inv.seeds', (v: any) => v === null || (typeof v === 'number' && v < 10)],
      ]);

      // Condition expects null or low number, null satisfies
      expect(ws.satisfies(conditions)).toBe(true);
    });
  });

  describe('keys and entries', () => {
    test('keys returns all fact keys', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 10);
      ws.set('has.hoe', true);
      ws.set('pos.farmCenter', new Vec3(0, 0, 0));

      const keys = ws.keys();
      expect(keys).toContain('inv.seeds');
      expect(keys).toContain('has.hoe');
      expect(keys).toContain('pos.farmCenter');
      expect(keys.length).toBe(3);
    });

    test('entries returns all key-value pairs', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 10);
      ws.set('has.hoe', true);

      const entries = ws.entries();
      expect(entries).toContainEqual(['inv.seeds', 10]);
      expect(entries).toContainEqual(['has.hoe', true]);
    });
  });

  describe('has and delete', () => {
    test('has returns true for existing keys', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 0); // Even zero is "has"
      expect(ws.has('inv.seeds')).toBe(true);
    });

    test('has returns false for missing keys', () => {
      const ws = new WorldState();
      expect(ws.has('inv.seeds')).toBe(false);
    });

    test('delete removes a key', () => {
      const ws = new WorldState();
      ws.set('inv.seeds', 10);
      expect(ws.has('inv.seeds')).toBe(true);

      ws.delete('inv.seeds');
      expect(ws.has('inv.seeds')).toBe(false);
      expect(ws.get('inv.seeds')).toBeNull();
    });
  });
});
