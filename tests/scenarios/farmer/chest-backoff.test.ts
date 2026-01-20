/**
 * SPEC: Chest checking backoff behavior
 *
 * When the shared chest is empty, the farmer should NOT spam-check it.
 * Instead, it should wait for a backoff period before checking again.
 */

import { describe, test, expect } from 'bun:test';
import { Vec3 } from 'vec3';
import { WorldState } from '../../../src/planning/WorldState';
import { CheckSharedChestAction } from '../../../src/planning/actions/FarmingActions';

describe('SPEC: Farmer chest checking backoff', () => {
    test('CheckSharedChest preconditions should fail when chest was recently found empty', () => {
        const action = new CheckSharedChestAction();
        const state = new WorldState();

        // Farmer needs tools and has storage access
        state.set('needs.tools', true);
        state.set('derived.hasStorageAccess', true);

        // But chest was found empty recently (within backoff period)
        state.set('derived.chestRecentlyEmpty', true);

        // CheckSharedChest should NOT be valid when chestRecentlyEmpty is true
        const canExecute = action.checkPreconditions(state);
        expect(canExecute).toBe(false);
    });

    test('CheckSharedChest should be valid when backoff period has expired', () => {
        const action = new CheckSharedChestAction();
        const state = new WorldState();

        // Farmer needs tools and has storage access
        state.set('needs.tools', true);
        state.set('derived.hasStorageAccess', true);

        // Backoff has expired
        state.set('derived.chestRecentlyEmpty', false);

        // Now it should be valid
        const canExecute = action.checkPreconditions(state);
        expect(canExecute).toBe(true);
    });

    test('chestRecentlyEmpty is derived from chestEmptyUntil timestamp', () => {
        // This tests that the blackboard correctly derives the fact
        const { WorldStateBuilder } = require('../../../src/planning/WorldStateBuilder');
        const { createBlackboard } = require('../../../src/roles/farming/Blackboard');

        const bb = createBlackboard();

        // When chestEmptyUntil is in the past, chestRecentlyEmpty should be false
        bb.chestEmptyUntil = Date.now() - 1000; // 1 second ago

        // Simulate bot for WorldStateBuilder
        const mockBot = {
            entity: { position: new Vec3(0, 64, 0) },
            inventory: { items: () => [] },
        };

        const ws = WorldStateBuilder.fromBlackboard(mockBot, bb);
        expect(ws.getBool('derived.chestRecentlyEmpty')).toBe(false);
    });

    test('chestRecentlyEmpty is true when chestEmptyUntil is in the future', () => {
        const { WorldStateBuilder } = require('../../../src/planning/WorldStateBuilder');
        const { createBlackboard } = require('../../../src/roles/farming/Blackboard');

        const bb = createBlackboard();

        // When chestEmptyUntil is in the future, chestRecentlyEmpty should be true
        bb.chestEmptyUntil = Date.now() + 30000; // 30 seconds in future

        const mockBot = {
            entity: { position: new Vec3(0, 64, 0) },
            inventory: { items: () => [] },
        };

        const ws = WorldStateBuilder.fromBlackboard(mockBot, bb);
        expect(ws.getBool('derived.chestRecentlyEmpty')).toBe(true);
    });
});
