/**
 * SPEC: CraftHoe behavior
 *
 * Tests that CraftHoe correctly handles crafting table requirements
 * to avoid the "No crafting table available" failure when the bot
 * has insufficient materials.
 */

import { describe, test, expect } from 'bun:test';
import { createFarmingActions } from '../../../src/planning/actions/FarmingActions';
import { createWorldState } from '../../mocks/world-state/base';

describe('SPEC: CraftHoe crafting table requirements', () => {
    const actions = createFarmingActions();
    const craftHoeAction = actions.find(a => a.name === 'CraftHoe')!;

    test('SPEC: CraftHoe preconditions pass with 2 logs (enough for table + hoe)', () => {
        const ws = createWorldState();
        ws.set('inv.logs', 2);
        ws.set('inv.planks', 0);
        ws.set('inv.sticks', 0);

        // 2 logs = 8 planks = enough for crafting table (4) + hoe materials
        expect(craftHoeAction.checkPreconditions(ws)).toBe(true);
    });

    test('SPEC: CraftHoe preconditions pass with 4+ planks (enough for table + head)', () => {
        const ws = createWorldState();
        ws.set('inv.logs', 0);
        ws.set('inv.planks', 4);
        ws.set('inv.sticks', 0);

        expect(craftHoeAction.checkPreconditions(ws)).toBe(true);
    });

    test('SPEC: CraftHoe preconditions pass with 2 planks + 2 sticks', () => {
        const ws = createWorldState();
        ws.set('inv.logs', 0);
        ws.set('inv.planks', 2);
        ws.set('inv.sticks', 2);

        // Note: Preconditions pass because we may have a crafting table nearby
        // The actual crafting table check happens at execution time
        expect(craftHoeAction.checkPreconditions(ws)).toBe(true);
    });

    test('SPEC: CraftHoe cost is lower when materials are ready', () => {
        const wsReady = createWorldState();
        wsReady.set('inv.logs', 0);
        wsReady.set('inv.planks', 2);
        wsReady.set('inv.sticks', 2);

        const wsNeedWork = createWorldState();
        wsNeedWork.set('inv.logs', 2);
        wsNeedWork.set('inv.planks', 0);
        wsNeedWork.set('inv.sticks', 0);

        const costReady = craftHoeAction.getCost(wsReady);
        const costNeedWork = craftHoeAction.getCost(wsNeedWork);

        // Ready materials should have lower cost
        expect(costReady).toBeLessThan(costNeedWork);
    });

    test('SPEC: CraftHoe preconditions fail with insufficient materials', () => {
        const ws = createWorldState();
        ws.set('inv.logs', 0);
        ws.set('inv.planks', 1);
        ws.set('inv.sticks', 1);

        // Not enough: need 2 logs OR 4 planks OR (2 planks + 2 sticks)
        expect(craftHoeAction.checkPreconditions(ws)).toBe(false);
    });
});
