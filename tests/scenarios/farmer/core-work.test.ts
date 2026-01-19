import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../../src/planning/GoalArbiter';
import { createFarmingGoals } from '../../../src/planning/goals/FarmingGoals';
import {
  farmerWithMatureCropsState,
  farmerReadyToPlantState,
  farmerNeedsTillingState,
  farmerGatheringSeedsState,
  farmerFoundWaterState,
  establishedFarmerState,
  freshSpawnFarmerState,
} from '../../mocks';

/**
 * SPECIFICATION: Farmer Core Work
 *
 * The farmer's primary responsibilities:
 * - Harvest mature crops
 * - Plant seeds on available farmland
 * - Till ground to create farmland
 * - Gather seeds when needed
 * - Establish farms near water
 */

describe('Farmer Core Work', () => {
  const goals = createFarmingGoals();
  const arbiter = new GoalArbiter(goals);

  describe('Harvesting', () => {
    test('SPEC: Mature crops should be harvested', () => {
      const ws = farmerWithMatureCropsState();
      ws.set('nearby.drops', 0);

      arbiter.clearCurrentGoal();
      const result = arbiter.selectGoal(ws);

      expect(result?.goal.name).toBe('HarvestCrops');
    });

    test('SPEC: More crops = higher utility (capped at 100)', () => {
      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;

      const ws1 = farmerWithMatureCropsState();
      ws1.set('nearby.matureCrops', 2);

      const ws2 = farmerWithMatureCropsState();
      ws2.set('nearby.matureCrops', 12);

      expect(harvestGoal.getUtility(ws2)).toBeGreaterThan(harvestGoal.getUtility(ws1));
      expect(harvestGoal.getUtility(ws2)).toBeLessThanOrEqual(100);
    });

    test('SPEC: Full inventory blocks harvesting', () => {
      const ws = farmerWithMatureCropsState();
      ws.set('state.inventoryFull', true);

      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;
      expect(harvestGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No mature crops = zero utility', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.matureCrops', 0);

      const harvestGoal = goals.find((g) => g.name === 'HarvestCrops')!;
      expect(harvestGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Planting', () => {
    test('SPEC: Seeds + farmland = should plant', () => {
      const ws = farmerReadyToPlantState();

      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;
      expect(plantGoal.getUtility(ws)).toBeGreaterThan(0);
    });

    test('SPEC: More farmland = higher utility', () => {
      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;

      const ws1 = farmerReadyToPlantState();
      ws1.set('nearby.farmland', 5);

      const ws2 = farmerReadyToPlantState();
      ws2.set('nearby.farmland', 15);

      expect(plantGoal.getUtility(ws2)).toBeGreaterThan(plantGoal.getUtility(ws1));
    });

    test('SPEC: Cannot plant without ability', () => {
      const ws = establishedFarmerState();
      ws.set('can.plant', false);

      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: No farmland = zero utility', () => {
      const ws = farmerReadyToPlantState();
      ws.set('nearby.farmland', 0);

      const plantGoal = goals.find((g) => g.name === 'PlantSeeds')!;
      expect(plantGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Tilling', () => {
    test('SPEC: Low farmland = high tilling priority (50)', () => {
      const ws = farmerNeedsTillingState();
      ws.set('nearby.farmland', 5);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(50);
    });

    test('SPEC: Medium farmland = medium priority (30)', () => {
      const ws = farmerNeedsTillingState();
      ws.set('nearby.farmland', 15);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(30);
    });

    test('SPEC: Lots of farmland = low priority (10)', () => {
      const ws = farmerNeedsTillingState();
      ws.set('nearby.farmland', 25);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(10);
    });

    test('SPEC: Cannot till without ability', () => {
      const ws = farmerNeedsTillingState();
      ws.set('can.till', false);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: Cannot till without farm', () => {
      const ws = farmerNeedsTillingState();
      ws.set('derived.hasFarmEstablished', false);

      const tillGoal = goals.find((g) => g.name === 'TillGround')!;
      expect(tillGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Seed Gathering', () => {
    test('SPEC: No hoe + farm = high seed priority (70)', () => {
      const ws = farmerGatheringSeedsState();
      ws.set('inv.seeds', 0);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBe(70);
    });

    test('SPEC: Some seeds + no hoe = still high priority (65)', () => {
      const ws = farmerGatheringSeedsState();
      ws.set('inv.seeds', 3);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBe(65);
    });

    test('SPEC: Enough seeds = zero utility', () => {
      const ws = farmerGatheringSeedsState();
      ws.set('inv.seeds', 15);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBe(0);
    });

    test('SPEC: With hoe, seed gathering is lower priority', () => {
      const ws = establishedFarmerState();
      ws.set('has.hoe', true);
      ws.set('inv.seeds', 2);

      const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
      expect(seedGoal.getUtility(ws)).toBeLessThan(60);
    });
  });

  describe('Farm Establishment', () => {
    test('SPEC: Found water = high establish priority (75)', () => {
      const ws = farmerFoundWaterState();

      const farmGoal = goals.find((g) => g.name === 'EstablishFarm')!;
      expect(farmGoal.getUtility(ws)).toBe(75);
    });

    test('SPEC: No water = medium priority (65)', () => {
      const ws = freshSpawnFarmerState();
      ws.set('has.studiedSigns', true);
      ws.set('nearby.water', 0);

      const farmGoal = goals.find((g) => g.name === 'EstablishFarm')!;
      expect(farmGoal.getUtility(ws)).toBe(65);
    });

    test('SPEC: Farm established = zero utility', () => {
      const ws = establishedFarmerState();

      const farmGoal = goals.find((g) => g.name === 'EstablishFarm')!;
      expect(farmGoal.getUtility(ws)).toBe(0);
    });
  });

  describe('Complete Farming Cycle', () => {
    test('SPEC: Till → Plant → Harvest → Deposit', () => {
      const ws = establishedFarmerState();
      ws.set('nearby.farmland', 0);
      ws.set('can.till', true);

      // Step 1: Till ground
      arbiter.clearCurrentGoal();
      let result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('TillGround');

      // Step 2: Plant
      ws.set('nearby.farmland', 15);
      ws.set('can.plant', true);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('PlantSeeds');

      // Step 3: Harvest
      ws.set('nearby.farmland', 0);
      ws.set('nearby.matureCrops', 12);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('HarvestCrops');

      // Step 4: Deposit
      ws.set('nearby.matureCrops', 0);
      ws.set('inv.produce', 35);
      result = arbiter.selectGoal(ws);
      expect(result?.goal.name).toBe('DepositProduce');
    });
  });
});
