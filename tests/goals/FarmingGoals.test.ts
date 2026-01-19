import { describe, test, expect } from 'bun:test';
import {
  CollectDropsGoal,
  HarvestCropsGoal,
  DepositProduceGoal,
  PlantSeedsGoal,
  TillGroundGoal,
  ObtainToolsGoal,
  GatherSeedsGoal,
  EstablishFarmGoal,
  StudySpawnSignsGoal,
  ExploreGoal,
  CompleteTradeGoal,
  RespondToTradeOfferGoal,
  BroadcastTradeOfferGoal,
} from '../../src/planning/goals/FarmingGoals';
import {
  freshSpawnFarmerState,
  establishedFarmerState,
  farmerWithMatureCropsState,
  farmerWithDropsState,
  farmerWithFullInventoryState,
  farmerNeedingHoeWithMaterialsState,
  farmerNeedingHoeWithChestState,
} from '../mocks';

describe('Farming Goals', () => {
  describe('CollectDropsGoal', () => {
    const goal = new CollectDropsGoal();

    test('returns 0 utility when no drops', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 0);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns high utility when drops nearby', () => {
      const ws = farmerWithDropsState();
      // 5 drops = 100 + 5*10 = 150 (capped)
      expect(goal.getUtility(ws)).toBe(150);
    });

    test('scales utility with drop count', () => {
      const ws = establishedFarmerState();

      ws.set('nearby.drops', 1);
      expect(goal.getUtility(ws)).toBe(110); // 100 + 1*10

      ws.set('nearby.drops', 3);
      expect(goal.getUtility(ws)).toBe(130); // 100 + 3*10
    });

    test('caps utility at 150', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 10); // Would be 200 uncapped
      expect(goal.getUtility(ws)).toBe(150);
    });

    test('condition requires zero drops', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.drops', 0);
      expect(goal.isSatisfied(ws)).toBe(true);

      ws.set('nearby.drops', 1);
      expect(goal.isSatisfied(ws)).toBe(false);
    });
  });

  describe('HarvestCropsGoal', () => {
    const goal = new HarvestCropsGoal();

    test('returns 0 utility when no crops', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.matureCrops', 0);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 0 utility when inventory full', () => {
      const ws = farmerWithFullInventoryState();
      ws.set('nearby.matureCrops', 10);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('scales utility with crop count', () => {
      const ws = farmerWithMatureCropsState();

      ws.set('nearby.matureCrops', 5);
      expect(goal.getUtility(ws)).toBe(75); // 60 + 5*3

      ws.set('nearby.matureCrops', 10);
      expect(goal.getUtility(ws)).toBe(90); // 60 + 10*3
    });

    test('caps utility at 100', () => {
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.matureCrops', 20); // Would be 120 uncapped
      expect(goal.getUtility(ws)).toBe(100);
    });
  });

  describe('DepositProduceGoal', () => {
    const goal = new DepositProduceGoal();

    test('returns 0 utility when no produce', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 0);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 0 utility when no storage access', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 32);
      ws.set('derived.hasStorageAccess', false);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 90 utility when inventory full', () => {
      const ws = farmerWithFullInventoryState();
      expect(goal.getUtility(ws)).toBe(90);
    });

    test('scales utility with produce count', () => {
      const ws = establishedFarmerState();
      ws.set('inv.produce', 10);
      expect(goal.getUtility(ws)).toBe(20);

      ws.set('inv.produce', 20);
      expect(goal.getUtility(ws)).toBe(40);

      ws.set('inv.produce', 40);
      expect(goal.getUtility(ws)).toBe(70);
    });
  });

  describe('PlantSeedsGoal', () => {
    const goal = new PlantSeedsGoal();

    test('returns 0 utility when cannot plant', () => {
      const ws = establishedFarmerState();
      ws.set('can.plant', false);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 0 utility when no farmland', () => {
      const ws = establishedFarmerState();
      ws.set('can.plant', true);
      ws.set('nearby.farmland', 0);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('scales utility with farmland', () => {
      const ws = establishedFarmerState();
      ws.set('can.plant', true);

      ws.set('nearby.farmland', 5);
      expect(goal.getUtility(ws)).toBe(40); // 30 + 5*2

      ws.set('nearby.farmland', 10);
      expect(goal.getUtility(ws)).toBe(50); // 30 + 10*2
    });

    test('caps utility at 60', () => {
      const ws = establishedFarmerState();
      ws.set('can.plant', true);
      ws.set('nearby.farmland', 20); // Would be 70 uncapped
      expect(goal.getUtility(ws)).toBe(60);
    });
  });

  describe('TillGroundGoal', () => {
    const goal = new TillGroundGoal();

    test('returns 0 utility when cannot till', () => {
      const ws = establishedFarmerState();
      ws.set('can.till', false);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 0 utility when no farm established', () => {
      const ws = freshSpawnFarmerState();
      ws.set('can.till', true);
      ws.set('derived.hasFarmEstablished', false);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('higher utility when little farmland', () => {
      const ws = establishedFarmerState();
      ws.set('can.till', true);

      ws.set('nearby.farmland', 5);
      expect(goal.getUtility(ws)).toBe(50);

      ws.set('nearby.farmland', 15);
      expect(goal.getUtility(ws)).toBe(30);

      ws.set('nearby.farmland', 25);
      expect(goal.getUtility(ws)).toBe(10);
    });
  });

  describe('ObtainToolsGoal', () => {
    const goal = new ObtainToolsGoal();

    test('returns 0 utility when has hoe', () => {
      const ws = establishedFarmerState();
      ws.set('has.hoe', true);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 95 utility when can craft', () => {
      const ws = farmerNeedingHoeWithMaterialsState();
      expect(goal.getUtility(ws)).toBe(95);
    });

    test('returns 80 utility when has storage access', () => {
      const ws = farmerNeedingHoeWithChestState();
      ws.set('derived.canCraftHoe', false);
      expect(goal.getUtility(ws)).toBe(80);
    });

    test('returns 40 utility when no materials and no chest', () => {
      const ws = freshSpawnFarmerState();
      ws.set('derived.canCraftHoe', false);
      ws.set('derived.hasStorageAccess', false);
      expect(goal.getUtility(ws)).toBe(40);
    });

    test('checks material combinations for craftability', () => {
      const ws = freshSpawnFarmerState();

      // Logs sufficient
      ws.set('inv.logs', 2);
      expect(goal.getUtility(ws)).toBe(95);

      // Planks sufficient
      ws.set('inv.logs', 0);
      ws.set('inv.planks', 4);
      expect(goal.getUtility(ws)).toBe(95);

      // Planks + sticks sufficient
      ws.set('inv.planks', 2);
      ws.set('inv.sticks', 2);
      expect(goal.getUtility(ws)).toBe(95);
    });
  });

  describe('GatherSeedsGoal', () => {
    const goal = new GatherSeedsGoal();

    test('returns 0 utility when has enough seeds', () => {
      const ws = establishedFarmerState();
      ws.set('inv.seeds', 15);
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('higher utility when no hoe but has farm', () => {
      const ws = establishedFarmerState();
      ws.set('has.hoe', false);
      ws.set('inv.seeds', 0);
      expect(goal.getUtility(ws)).toBe(70);
    });

    test('normal utility when has hoe', () => {
      const ws = establishedFarmerState();
      ws.set('inv.seeds', 0);
      expect(goal.getUtility(ws)).toBe(55);
    });

    test('scales utility with seed count', () => {
      const ws = establishedFarmerState();

      ws.set('inv.seeds', 0);
      expect(goal.getUtility(ws)).toBe(55);

      ws.set('inv.seeds', 3);
      expect(goal.getUtility(ws)).toBe(45);

      ws.set('inv.seeds', 7);
      expect(goal.getUtility(ws)).toBe(30);
    });
  });

  describe('EstablishFarmGoal', () => {
    const goal = new EstablishFarmGoal();

    test('returns 0 utility when farm established', () => {
      const ws = establishedFarmerState();
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('returns 75 utility when water found', () => {
      const ws = freshSpawnFarmerState();
      ws.set('nearby.water', 1);
      expect(goal.getUtility(ws)).toBe(75);
    });

    test('returns 65 utility when no water yet', () => {
      const ws = freshSpawnFarmerState();
      ws.set('nearby.water', 0);
      expect(goal.getUtility(ws)).toBe(65);
    });
  });

  describe('StudySpawnSignsGoal', () => {
    const goal = new StudySpawnSignsGoal();

    test('returns 200 utility when not studied', () => {
      const ws = freshSpawnFarmerState();
      expect(goal.getUtility(ws)).toBe(200);
    });

    test('returns 0 utility when already studied', () => {
      const ws = establishedFarmerState();
      expect(goal.getUtility(ws)).toBe(0);
    });

    test('isValid returns false when studied', () => {
      const ws = establishedFarmerState();
      expect(goal.isValid(ws)).toBe(false);
    });
  });

  describe('ExploreGoal', () => {
    const goal = new ExploreGoal();

    test('returns low base utility', () => {
      const ws = establishedFarmerState();
      ws.set('state.consecutiveIdleTicks', 0);
      expect(goal.getUtility(ws)).toBe(5);
    });

    test('increases utility when idle', () => {
      const ws = establishedFarmerState();

      ws.set('state.consecutiveIdleTicks', 10);
      expect(goal.getUtility(ws)).toBe(20); // 15 + 10/2 = 20

      ws.set('state.consecutiveIdleTicks', 50);
      expect(goal.getUtility(ws)).toBe(40); // 15 + 25 (capped)
    });

    test('isValid always returns true', () => {
      const ws = freshSpawnFarmerState();
      expect(goal.isValid(ws)).toBe(true);
    });
  });

  describe('Trade Goals', () => {
    describe('CompleteTradeGoal', () => {
      const goal = new CompleteTradeGoal();

      test('returns 0 utility when not in active trade', () => {
        const ws = establishedFarmerState();
        ws.set('trade.status', '');
        expect(goal.getUtility(ws)).toBe(0);

        ws.set('trade.status', 'idle');
        expect(goal.getUtility(ws)).toBe(0);
      });

      test('returns 150 utility for active trade statuses', () => {
        const ws = establishedFarmerState();

        for (const status of ['accepted', 'traveling', 'ready', 'dropping', 'picking_up']) {
          ws.set('trade.status', status);
          expect(goal.getUtility(ws)).toBe(150);
        }
      });

      test('isValid only for actionable statuses', () => {
        const ws = establishedFarmerState();

        ws.set('trade.status', 'accepted');
        expect(goal.isValid(ws)).toBe(true);

        ws.set('trade.status', 'offering');
        expect(goal.isValid(ws)).toBe(false);

        ws.set('trade.status', 'wanting');
        expect(goal.isValid(ws)).toBe(false);
      });
    });

    describe('RespondToTradeOfferGoal', () => {
      const goal = new RespondToTradeOfferGoal();

      test('returns 0 utility when no pending offers', () => {
        const ws = establishedFarmerState();
        ws.set('trade.pendingOffers', 0);
        expect(goal.getUtility(ws)).toBe(0);
      });

      test('returns 0 utility when already in trade', () => {
        const ws = establishedFarmerState();
        ws.set('trade.pendingOffers', 2);
        ws.set('trade.inTrade', true);
        expect(goal.getUtility(ws)).toBe(0);
      });

      test('returns 120 utility when offers available', () => {
        const ws = establishedFarmerState();
        ws.set('trade.pendingOffers', 2);
        ws.set('trade.inTrade', false);
        ws.set('trade.status', '');
        expect(goal.getUtility(ws)).toBe(120);
      });
    });

    describe('BroadcastTradeOfferGoal', () => {
      const goal = new BroadcastTradeOfferGoal();

      test('returns 0 utility when too few tradeable items', () => {
        const ws = establishedFarmerState();
        ws.set('trade.tradeableCount', 3);
        expect(goal.getUtility(ws)).toBe(0);
      });

      test('returns 0 utility when in trade', () => {
        const ws = establishedFarmerState();
        ws.set('trade.tradeableCount', 10);
        ws.set('trade.inTrade', true);
        expect(goal.getUtility(ws)).toBe(0);
      });

      test('returns 0 utility when on cooldown', () => {
        const ws = establishedFarmerState();
        ws.set('trade.tradeableCount', 10);
        ws.set('trade.onCooldown', true);
        expect(goal.getUtility(ws)).toBe(0);
      });

      test('returns 150 utility when already offering', () => {
        const ws = establishedFarmerState();
        ws.set('trade.status', 'offering');
        expect(goal.getUtility(ws)).toBe(150);
      });

      test('scales utility with tradeable count', () => {
        const ws = establishedFarmerState();
        ws.set('trade.status', '');
        ws.set('trade.inTrade', false);
        ws.set('trade.onCooldown', false);

        ws.set('trade.tradeableCount', 4);
        expect(goal.getUtility(ws)).toBe(34); // 30 + 4 (first tier)

        ws.set('trade.tradeableCount', 8);
        expect(goal.getUtility(ws)).toBe(38); // 30 + 8
      });
    });
  });
});
