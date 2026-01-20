/**
 * SPEC: Memory cleanup tests for VillageChat and Blackboards
 *
 * These tests verify that memory cleanup functions are called
 * and that arrays/maps don't grow unbounded.
 */

import { describe, test, expect, beforeEach, jest, spyOn } from 'bun:test';
import { Vec3 } from 'vec3';
import { VillageChat } from '../../src/shared/VillageChat';
import type { Bot } from 'mineflayer';

// Simple mock bot for testing
function createMockBot(): Bot {
    const listeners: Map<string, Function[]> = new Map();
    return {
        username: 'TestBot',
        entity: { position: new Vec3(0, 64, 0) },
        on: (event: string, handler: Function) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push(handler);
        },
        removeListener: (event: string, handler: Function) => {
            const eventListeners = listeners.get(event);
            if (eventListeners) {
                const idx = eventListeners.indexOf(handler);
                if (idx >= 0) eventListeners.splice(idx, 1);
            }
        },
        chat: jest.fn(),
        // Simulate receiving a chat message
        _simulateChat: (username: string, message: string) => {
            const chatListeners = listeners.get('chat') || [];
            chatListeners.forEach(l => l(username, message));
        },
    } as any;
}

describe('SPEC: VillageChat memory cleanup', () => {
    let bot: Bot & { _simulateChat: Function };
    let villageChat: VillageChat;

    beforeEach(() => {
        bot = createMockBot() as any;
        villageChat = new VillageChat(bot);
    });

    describe('cleanupOldNeeds', () => {
        test('should clean up needs older than maxAge', () => {
            // Simulate receiving old needs
            const oldTimestamp = Date.now() - 400000; // 400 seconds ago
            const recentTimestamp = Date.now() - 100000; // 100 seconds ago

            // Simulate receiving needs from other bots
            bot._simulateChat('Farmer', '[NEED] farmer-hoe-old hoe');

            // Manually make one need old by accessing internal state
            const incomingNeeds = villageChat.getIncomingNeeds();
            expect(incomingNeeds.length).toBe(1);

            // Modify timestamp to make it old (for testing)
            (incomingNeeds[0] as any).timestamp = oldTimestamp;

            // Add a recent need
            bot._simulateChat('Lumberjack', '[NEED] lumberjack-axe-recent axe');
            expect(villageChat.getIncomingNeeds().length).toBe(2);

            // Cleanup with 5 minute (300s) maxAge
            villageChat.cleanupOldNeeds(300000);

            // Old need should be removed, recent one should remain
            expect(villageChat.getIncomingNeeds().length).toBe(1);
            expect(villageChat.getIncomingNeeds()[0]!.id).toBe('lumberjack-axe-recent');
        });

        test('should clean up activeNeeds older than maxAge', () => {
            // Broadcast a need
            villageChat.broadcastNeed('hoe');
            expect(villageChat.getActiveNeeds().length).toBe(1);

            // Make it old
            const activeNeeds = villageChat.getActiveNeeds();
            (activeNeeds[0] as any).timestamp = Date.now() - 400000;

            // Cleanup
            villageChat.cleanupOldNeeds(300000);

            // Should be removed
            expect(villageChat.getActiveNeeds().length).toBe(0);
        });
    });

    describe('cleanupOldTerraformRequests', () => {
        test('should remove done terraform requests older than maxAge', () => {
            // Simulate terraform request
            bot._simulateChat('Farmer', '[TERRAFORM] 100 64 200');
            expect(villageChat.getAllTerraformRequests().length).toBe(1);

            // Mark as done
            bot._simulateChat('Landscaper', '[TERRAFORM_DONE] 100 64 200');
            expect(villageChat.getAllTerraformRequests()[0]!.status).toBe('done');

            // Make it old
            (villageChat.getAllTerraformRequests()[0] as any).timestamp = Date.now() - 700000; // 11+ minutes

            // Cleanup (10 minute maxAge)
            villageChat.cleanupOldTerraformRequests(600000);

            // Should be removed
            expect(villageChat.getAllTerraformRequests().length).toBe(0);
        });

        test('should NOT remove pending terraform requests regardless of age', () => {
            // Simulate terraform request
            bot._simulateChat('Farmer', '[TERRAFORM] 100 64 200');

            // Make it old
            (villageChat.getAllTerraformRequests()[0] as any).timestamp = Date.now() - 700000;

            // Cleanup
            villageChat.cleanupOldTerraformRequests(600000);

            // Should remain (not done)
            expect(villageChat.getAllTerraformRequests().length).toBe(1);
        });
    });

    describe('cleanupOldTradeOffers', () => {
        test('should remove offers older than maxAge', () => {
            // Simulate trade offer
            bot._simulateChat('Farmer', '[OFFER] oak_sapling 4');
            expect(villageChat.getActiveOffers().length).toBe(1);

            // Make it old
            (villageChat.getActiveOffers()[0] as any).timestamp = Date.now() - 70000; // 70 seconds

            // Cleanup (60 second maxAge)
            villageChat.cleanupOldTradeOffers(60000);

            // Should be removed
            expect(villageChat.getActiveOffers().length).toBe(0);
        });
    });
});

describe('SPEC: VillageChat event listener cleanup', () => {
    test('should provide a cleanup method to remove event listeners', () => {
        const bot = createMockBot();
        const villageChat = new VillageChat(bot);

        // VillageChat should have a cleanup/destroy method
        expect(typeof (villageChat as any).cleanup).toBe('function');
    });
});

describe('SPEC: Bounded array growth', () => {
    test('activeOffers should not grow unbounded when same bot offers repeatedly', () => {
        const bot = createMockBot() as any;
        const villageChat = new VillageChat(bot);

        // Same bot offers multiple times
        for (let i = 0; i < 10; i++) {
            bot._simulateChat('Farmer', `[OFFER] oak_sapling ${i}`);
        }

        // Should only have one offer per bot (latest one)
        expect(villageChat.getActiveOffers().length).toBe(1);
        expect(villageChat.getActiveOffers()[0]!.quantity).toBe(9); // Last offer
    });
});
