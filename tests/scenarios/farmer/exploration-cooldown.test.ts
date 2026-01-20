/**
 * SPEC: Exploration cooldown
 *
 * Tests that the Explore action has proper cooldown to prevent rapid goal cycling.
 * The issue was that Explore's 5-second internal cooldown returned 'failure' immediately,
 * causing rapid goal selection → action failure → goal selection cycles.
 */

import { describe, test, expect } from 'bun:test';
import { createFarmingActions } from '../../../src/planning/actions/FarmingActions';
import { createWorldState } from '../../mocks/world-state/base';

describe('SPEC: Exploration cooldown', () => {
    const actions = createFarmingActions();
    const exploreAction = actions.find(a => a.name === 'Explore')!;

    test('SPEC: Explore is not available when on cooldown', () => {
        const ws = createWorldState();
        ws.set('derived.exploreOnCooldown', true);

        // Preconditions should fail when on cooldown
        expect(exploreAction.checkPreconditions(ws)).toBe(false);
    });

    test('SPEC: Explore is available when not on cooldown', () => {
        const ws = createWorldState();
        ws.set('derived.exploreOnCooldown', false);

        // Preconditions should pass when not on cooldown
        expect(exploreAction.checkPreconditions(ws)).toBe(true);
    });
});
