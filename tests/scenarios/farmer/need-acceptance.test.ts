import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'events';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import { freshSpawnFarmerState, farmerWithDropsState } from '../../mocks';
import { VillageChat } from '../../../src/shared/VillageChat';

/**
 * SPECIFICATION: Multi-Bot Need Fulfillment Coordination
 *
 * Tests the complete flow of need broadcasting, offer collection, acceptance,
 * and delivery pickup - specifically addressing goal preemption issues.
 *
 * THE BUG (before fix):
 * 1. Farmer broadcasts [NEED] hoe
 * 2. BroadcastNeed action sets status='broadcasting', returns RUNNING
 * 3. Before 30 second offer window expires, goal switches to CollectDrops
 * 4. BroadcastNeed stops being ticked, offer window timer doesn't progress
 * 5. Lumberjack sends offer, but farmer never accepts it
 * 6. Farmer stays stuck without tools
 *
 * THE FIX:
 * - Offer acceptance should happen in blackboard update, not in action tick
 * - When a need has been in 'broadcasting' status long enough AND has offers,
 *   automatically transition to 'accepted' and select the best provider
 */

describe('Need Acceptance Flow', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);
  let villageChat: VillageChat;
  let mockBot: EventEmitter & { username: string; chat: (msg: string) => void };

  beforeEach(() => {
    // Create a mock bot with EventEmitter for chat events
    mockBot = Object.assign(new EventEmitter(), {
      username: 'Oran_Farmer',
      chat: () => {},
    });
    villageChat = new VillageChat(mockBot as any);
  });

  afterEach(() => {
    villageChat.cleanup();
  });

  describe('SPEC: Goal preemption should not break need acceptance', () => {
    test('need should auto-accept after offer window even without action ticking', () => {
      // Farmer broadcasts need
      const needId = villageChat.broadcastNeed('hoe');
      const need = villageChat.getNeedById(needId);
      expect(need).toBeDefined();
      expect(need!.status).toBe('broadcasting');

      // Simulate receiving an offer from lumberjack via chat event
      mockBot.emit('chat', 'Arnulfo_Lmbr', `[CAN_PROVIDE] ${needId} full mats:oak_log:2,stick:2`);

      // Verify offer was received
      const offers = villageChat.getRankedOffersForNeed(needId);
      expect(offers.length).toBe(1);
      expect(offers[0]!.from).toBe('Arnulfo_Lmbr');

      // Simulate time passing by manually setting the timestamp in the past
      // (backdating the need's timestamp to simulate 30+ seconds elapsed)
      need!.timestamp = Date.now() - 31000; // 31 seconds ago

      // Process timeout - should auto-accept after the window
      villageChat.processNeedTimeouts();

      // Get updated need state
      const updatedNeed = villageChat.getNeedById(needId);

      // Need should now be accepted with the best provider selected
      expect(updatedNeed!.status).toBe('accepted');
      expect(updatedNeed!.acceptedProvider).toBe('Arnulfo_Lmbr');
    });

    test('ReceiveNeedDelivery goal activates when need is accepted with delivery location', () => {
      const ws = freshSpawnFarmerState();

      // Mark signs as studied so StudySpawnSigns doesn't preempt
      ws.set('has.studiedSigns', true);

      // Simulate need accepted with delivery location set
      ws.set('need.hasPendingDelivery', true);
      ws.set('need.deliveryDistance', 10);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      // Should select ReceiveNeedDelivery goal
      expect(result?.goal.name).toBe('ReceiveNeedDelivery');
      // Very high priority to not miss the dropped items (must preempt CollectDrops)
      expect(result?.utility).toBeGreaterThanOrEqual(180);
    });

    test('ReceiveNeedDelivery preempts CollectDrops when items are for need', () => {
      // CollectDrops is high priority (utility ~120) but ReceiveNeedDelivery
      // should be even higher to handle need fulfillment
      const wsWithDrops = farmerWithDropsState();
      wsWithDrops.set('need.hasPendingDelivery', true);
      wsWithDrops.set('need.deliveryDistance', 5);

      const collectDropsGoal = goals.find(g => g.name === 'CollectDrops')!;
      const receiveDeliveryGoal = goals.find(g => g.name === 'ReceiveNeedDelivery')!;

      const dropsUtility = collectDropsGoal.getUtility(wsWithDrops);
      const deliveryUtility = receiveDeliveryGoal.getUtility(wsWithDrops);

      // ReceiveNeedDelivery must be high enough to preempt CollectDrops + 30 threshold
      expect(deliveryUtility).toBeGreaterThan(dropsUtility + 30);
    });
  });

  describe('SPEC: Blackboard pendingDelivery detection', () => {
    test('pendingDelivery is set when need has accepted provider and delivery location', () => {
      // This tests the blackboard update logic at Blackboard.ts:525-548
      // When need.status === 'accepted' && need.deliveryLocation && need.acceptedProvider
      // then bb.pendingDelivery should be populated

      const needId = villageChat.broadcastNeed('hoe');

      // Simulate provider offering via chat event
      mockBot.emit('chat', 'Arnulfo_Lmbr', `[CAN_PROVIDE] ${needId} full mats:oak_log:2`);

      // Accept the provider
      villageChat.acceptProvider(needId, 'Arnulfo_Lmbr');

      // Simulate provider announcing delivery location via chat event
      mockBot.emit('chat', 'Arnulfo_Lmbr', `[PROVIDE_AT] ${needId} trade 100 64 200`);

      const need = villageChat.getNeedById(needId);
      expect(need!.status).toBe('accepted');
      expect(need!.deliveryLocation).toBeDefined();
      expect(need!.acceptedProvider).toBe('Arnulfo_Lmbr');
    });
  });

  describe('SPEC: Offer window timing', () => {
    test('offers received during window are collected', () => {
      const needId = villageChat.broadcastNeed('hoe');

      // Multiple bots offer via chat events
      mockBot.emit('chat', 'Bot1', `[CAN_PROVIDE] ${needId} full item:wooden_hoe:1`);
      mockBot.emit('chat', 'Bot2', `[CAN_PROVIDE] ${needId} partial mats:oak_log:1`);

      const offers = villageChat.getRankedOffersForNeed(needId);
      expect(offers.length).toBe(2);

      // Item offer should rank higher than materials
      expect(offers[0]!.from).toBe('Bot1');
      expect(offers[0]!.type).toBe('item');
    });

    test('best offer is selected when accepting', () => {
      const needId = villageChat.broadcastNeed('hoe');
      const need = villageChat.getNeedById(needId);

      // Worse offer first
      mockBot.emit('chat', 'Bot2', `[CAN_PROVIDE] ${needId} partial mats:oak_log:1`);
      // Better offer second
      mockBot.emit('chat', 'Bot1', `[CAN_PROVIDE] ${needId} full item:stone_hoe:1`);

      // Simulate time passing
      need!.timestamp = Date.now() - 31000;

      // Process timeout to auto-accept
      villageChat.processNeedTimeouts();

      const updatedNeed = villageChat.getNeedById(needId);
      // Should accept Bot1 (better offer) even though Bot2 was first
      expect(updatedNeed!.acceptedProvider).toBe('Bot1');
    });
  });
});
