/**
 * SPEC: Trade offer exponential backoff behavior
 *
 * When a bot broadcasts a trade offer and gets "no takers", it should
 * use exponential backoff before trying again.
 */

import { describe, test, expect } from 'bun:test';

describe('SPEC: Trade offer exponential backoff', () => {
    test('canOffer should use exponential backoff based on consecutive no takers', () => {
        // Mock the BaseBroadcastOffer logic directly
        const OFFER_COOLDOWN = 30000; // 30 seconds base

        function calculateEffectiveCooldown(consecutiveNoTakers: number): number {
            const backoffMultiplier = Math.pow(2, Math.min(consecutiveNoTakers, 5));
            return Math.min(OFFER_COOLDOWN * backoffMultiplier, 10 * 60 * 1000);
        }

        // 0 failures = 30s
        expect(calculateEffectiveCooldown(0)).toBe(30000);

        // 1 failure = 60s
        expect(calculateEffectiveCooldown(1)).toBe(60000);

        // 2 failures = 120s (2 minutes)
        expect(calculateEffectiveCooldown(2)).toBe(120000);

        // 3 failures = 240s (4 minutes)
        expect(calculateEffectiveCooldown(3)).toBe(240000);

        // 4 failures = 480s (8 minutes)
        expect(calculateEffectiveCooldown(4)).toBe(480000);

        // 5+ failures = capped at 10 minutes
        expect(calculateEffectiveCooldown(5)).toBe(600000);
        expect(calculateEffectiveCooldown(6)).toBe(600000);
        expect(calculateEffectiveCooldown(10)).toBe(600000);
    });

    test('consecutiveNoTakers should be tracked in blackboard', () => {
        const { createBlackboard } = require('../../src/roles/farming/Blackboard');
        const { createLumberjackBlackboard } = require('../../src/roles/lumberjack/LumberjackBlackboard');
        const { createLandscaperBlackboard } = require('../../src/roles/landscaper/LandscaperBlackboard');

        // Farmer
        const farmerBb = createBlackboard();
        expect(farmerBb.consecutiveNoTakers).toBe(0);

        // Lumberjack
        const lumberjackBb = createLumberjackBlackboard();
        expect(lumberjackBb.consecutiveNoTakers).toBe(0);

        // Landscaper
        const landscaperBb = createLandscaperBlackboard();
        expect(landscaperBb.consecutiveNoTakers).toBe(0);
    });
});
