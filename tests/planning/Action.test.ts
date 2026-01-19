import { describe, test, expect } from 'bun:test';
import {
  numericPrecondition,
  booleanPrecondition,
  incrementEffect,
  setEffect,
  BaseGOAPAction,
  ActionResult,
} from '../../src/planning/Action';
import { WorldState } from '../../src/planning/WorldState';

describe('Precondition helpers', () => {
  describe('numericPrecondition', () => {
    test('checks numeric values correctly', () => {
      const precond = numericPrecondition('inv.seeds', (v) => v >= 10, 'has seeds');

      const ws = new WorldState();
      ws.set('inv.seeds', 15);
      expect(precond.check(ws.get('inv.seeds'))).toBe(true);

      ws.set('inv.seeds', 5);
      expect(precond.check(ws.get('inv.seeds'))).toBe(false);
    });

    test('treats non-numeric as 0', () => {
      const precond = numericPrecondition('inv.seeds', (v) => v > 0, 'has seeds');

      const ws = new WorldState();
      ws.set('inv.seeds', 'invalid');
      expect(precond.check(ws.get('inv.seeds'))).toBe(false);

      // Missing key also treated as 0
      expect(precond.check(ws.get('nonexistent'))).toBe(false);
    });
  });

  describe('booleanPrecondition', () => {
    test('checks boolean values correctly', () => {
      const precond = booleanPrecondition('has.hoe', true, 'has hoe');

      const ws = new WorldState();
      ws.set('has.hoe', true);
      expect(precond.check(ws.get('has.hoe'))).toBe(true);

      ws.set('has.hoe', false);
      expect(precond.check(ws.get('has.hoe'))).toBe(false);
    });

    test('treats non-boolean as false', () => {
      const precond = booleanPrecondition('has.hoe', true, 'has hoe');

      const ws = new WorldState();
      ws.set('has.hoe', 'true'); // String, not boolean
      expect(precond.check(ws.get('has.hoe'))).toBe(false);

      // Missing key also treated as false
      expect(precond.check(ws.get('nonexistent'))).toBe(false);
    });

    test('can check for false', () => {
      const precond = booleanPrecondition('state.inventoryFull', false, 'inventory not full');

      const ws = new WorldState();
      ws.set('state.inventoryFull', false);
      expect(precond.check(ws.get('state.inventoryFull'))).toBe(true);

      ws.set('state.inventoryFull', true);
      expect(precond.check(ws.get('state.inventoryFull'))).toBe(false);
    });
  });
});

describe('Effect helpers', () => {
  describe('incrementEffect', () => {
    test('increments numeric values', () => {
      const effect = incrementEffect('inv.seeds', 5, 'gained seeds');

      const ws = new WorldState();
      ws.set('inv.seeds', 10);

      const newValue = effect.apply(ws);
      expect(newValue).toBe(15);
    });

    test('treats missing key as 0', () => {
      const effect = incrementEffect('inv.seeds', 5, 'gained seeds');

      const ws = new WorldState();
      // inv.seeds not set

      const newValue = effect.apply(ws);
      expect(newValue).toBe(5);
    });

    test('supports negative increments', () => {
      const effect = incrementEffect('inv.seeds', -5, 'used seeds');

      const ws = new WorldState();
      ws.set('inv.seeds', 10);

      const newValue = effect.apply(ws);
      expect(newValue).toBe(5);
    });
  });

  describe('setEffect', () => {
    test('sets value directly', () => {
      const effect = setEffect('has.hoe', true, 'got hoe');

      const ws = new WorldState();
      const newValue = effect.apply(ws);
      expect(newValue).toBe(true);
    });

    test('sets numeric value', () => {
      const effect = setEffect('inv.produce', 0, 'deposited');

      const ws = new WorldState();
      ws.set('inv.produce', 50);

      const newValue = effect.apply(ws);
      expect(newValue).toBe(0);
    });

    test('sets null value', () => {
      const effect = setEffect('pos.target', null, 'cleared target');

      const ws = new WorldState();
      const newValue = effect.apply(ws);
      expect(newValue).toBeNull();
    });
  });
});

describe('BaseGOAPAction', () => {
  class TestAction extends BaseGOAPAction {
    name = 'TestAction';

    preconditions = [
      numericPrecondition('inv.seeds', (v) => v >= 5, 'has seeds'),
      booleanPrecondition('has.hoe', true, 'has hoe'),
    ];

    effects = [
      incrementEffect('inv.seeds', -5, 'planted seeds'),
      incrementEffect('nearby.farmland', 10, 'filled farmland'),
    ];

    async execute(): Promise<ActionResult> {
      return ActionResult.SUCCESS;
    }
  }

  describe('checkPreconditions', () => {
    test('returns true when all preconditions satisfied', () => {
      const action = new TestAction();
      const ws = new WorldState();
      ws.set('inv.seeds', 10);
      ws.set('has.hoe', true);

      expect(action.checkPreconditions(ws)).toBe(true);
    });

    test('returns false when any precondition fails', () => {
      const action = new TestAction();
      const ws = new WorldState();
      ws.set('inv.seeds', 3); // Not enough
      ws.set('has.hoe', true);

      expect(action.checkPreconditions(ws)).toBe(false);
    });

    test('returns false when precondition key missing', () => {
      const action = new TestAction();
      const ws = new WorldState();
      // Neither key set

      expect(action.checkPreconditions(ws)).toBe(false);
    });
  });

  describe('applyEffects', () => {
    test('applies all effects to world state', () => {
      const action = new TestAction();
      const ws = new WorldState();
      ws.set('inv.seeds', 20);
      ws.set('nearby.farmland', 5);

      action.applyEffects(ws);

      expect(ws.get('inv.seeds')).toBe(15); // 20 - 5
      expect(ws.get('nearby.farmland')).toBe(15); // 5 + 10
    });

    test('handles missing keys', () => {
      const action = new TestAction();
      const ws = new WorldState();
      // No keys set

      action.applyEffects(ws);

      expect(ws.get('inv.seeds')).toBe(-5); // 0 - 5
      expect(ws.get('nearby.farmland')).toBe(10); // 0 + 10
    });
  });

  describe('getCost', () => {
    test('default cost is 1.0', () => {
      const action = new TestAction();
      const ws = new WorldState();

      expect(action.getCost(ws)).toBe(1.0);
    });

    test('can be overridden', () => {
      class ExpensiveAction extends TestAction {
        override getCost(): number {
          return 5.0;
        }
      }

      const action = new ExpensiveAction();
      const ws = new WorldState();

      expect(action.getCost(ws)).toBe(5.0);
    });

    test('can be dynamic based on world state', () => {
      class DynamicCostAction extends TestAction {
        override getCost(ws: WorldState): number {
          // Cheaper when grass is nearby
          return ws.getNumber('nearby.grass') > 0 ? 1.0 : 3.0;
        }
      }

      const action = new DynamicCostAction();

      const wsWithGrass = new WorldState();
      wsWithGrass.set('nearby.grass', 5);
      expect(action.getCost(wsWithGrass)).toBe(1.0);

      const wsNoGrass = new WorldState();
      wsNoGrass.set('nearby.grass', 0);
      expect(action.getCost(wsNoGrass)).toBe(3.0);
    });
  });

  describe('getDescription', () => {
    test('returns human-readable description', () => {
      const action = new TestAction();
      const desc = action.getDescription();

      expect(desc).toContain('TestAction');
      expect(desc).toContain('has seeds');
      expect(desc).toContain('has hoe');
      expect(desc).toContain('planted seeds');
    });
  });
});
