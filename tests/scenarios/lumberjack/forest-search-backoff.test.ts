/**
 * SPEC: Forest search backoff behavior
 *
 * When the lumberjack fails to find a forest after maximum exploration attempts,
 * it should back off and not immediately try again.
 */

import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { WorldState } from '../../../src/planning/WorldState';
import { FindForestAction } from '../../../src/planning/actions/LumberjackActions';

describe('SPEC: Lumberjack forest search backoff', () => {
    test('FindForest preconditions should fail when forest search recently failed', () => {
        const action = new FindForestAction();
        const state = new WorldState();

        // Lumberjack has studied signs but no known forest
        state.set('has.studiedSigns', true);
        state.set('has.knownForest', false);

        // But forest search recently failed (within backoff period)
        state.set('derived.forestSearchRecentlyFailed', true);

        // FindForest should NOT be valid when forestSearchRecentlyFailed is true
        const canExecute = action.checkPreconditions(state);
        expect(canExecute).toBe(false);
    });

    test('FindForest should be valid when backoff period has expired', () => {
        const action = new FindForestAction();
        const state = new WorldState();

        // Lumberjack has studied signs but no known forest
        state.set('has.studiedSigns', true);
        state.set('has.knownForest', false);

        // Backoff has expired
        state.set('derived.forestSearchRecentlyFailed', false);

        // Now it should be valid
        const canExecute = action.checkPreconditions(state);
        expect(canExecute).toBe(true);
    });

    test('forestSearchRecentlyFailed is derived from forestSearchFailedUntil timestamp', () => {
        const { WorldStateBuilder } = require('../../../src/planning/WorldStateBuilder');
        const { createLumberjackBlackboard } = require('../../../src/roles/lumberjack/LumberjackBlackboard');

        const bb = createLumberjackBlackboard();

        // When forestSearchFailedUntil is in the past, forestSearchRecentlyFailed should be false
        bb.forestSearchFailedUntil = Date.now() - 1000; // 1 second ago

        const mockBot = {
            entity: { position: new Vec3(0, 64, 0) },
            inventory: { items: () => [], emptySlotCount: () => 36 },
            players: {},
        };

        const ws = WorldStateBuilder.fromBlackboard(mockBot, bb);
        expect(ws.getBool('derived.forestSearchRecentlyFailed')).toBe(false);
    });

    test('forestSearchRecentlyFailed is true when forestSearchFailedUntil is in the future', () => {
        const { WorldStateBuilder } = require('../../../src/planning/WorldStateBuilder');
        const { createLumberjackBlackboard } = require('../../../src/roles/lumberjack/LumberjackBlackboard');

        const bb = createLumberjackBlackboard();

        // When forestSearchFailedUntil is in the future, forestSearchRecentlyFailed should be true
        bb.forestSearchFailedUntil = Date.now() + 60000; // 60 seconds in future

        const mockBot = {
            entity: { position: new Vec3(0, 64, 0) },
            inventory: { items: () => [], emptySlotCount: () => 36 },
            players: {},
        };

        const ws = WorldStateBuilder.fromBlackboard(mockBot, bb);
        expect(ws.getBool('derived.forestSearchRecentlyFailed')).toBe(true);
    });
});
