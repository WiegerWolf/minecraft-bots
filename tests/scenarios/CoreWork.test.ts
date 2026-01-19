import { describe, test, expect } from 'bun:test';
import { GoalArbiter } from '../../src/planning/GoalArbiter';
import { createLumberjackGoals } from '../../src/planning/goals/LumberjackGoals';
import { createFarmingGoals } from '../../src/planning/goals/FarmingGoals';
import { createLandscaperGoals } from '../../src/planning/goals/LandscaperGoals';
import {
  lumberjackReadyToChopState,
  lumberjackMidTreeHarvestState,
  lumberjackWithSaplingsState,
  farmerWithMatureCropsState,
  farmerReadyToPlantState,
  farmerNeedsTillingState,
  farmerGatheringSeedsState,
  establishedFarmerState,
  landscaperWithTerraformRequestState,
  landscaperActiveTerraformState,
  landscaperIdleState,
  landscaperWithFarmsToCheckState,
  landscaperWithFarmMaintenanceState,
} from '../mocks';

/**
 * SPECIFICATION: Core Work
 *
 * Each role has primary responsibilities that define their core work:
 * - Lumberjack: Chop trees, plant saplings, process wood
 * - Farmer: Harvest crops, plant seeds, till ground, gather seeds
 * - Landscaper: Fulfill terraform requests, maintain farms, gather dirt
 *
 * Core work has specific utility values and conditions.
 */

describe('Core Work', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // LUMBERJACK CORE WORK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lumberjack Core Work', () => {
    const goals = createLumberjackGoals();
    const arbiter = new GoalArbiter(goals);

    describe('Tree Chopping', () => {
      test('SPEC: With axe and trees, should chop', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('nearby.reachableTrees', 5);

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('ChopTree');
      });

      test('SPEC: More trees = higher utility', () => {
        const chopGoal = goals.find((g) => g.name === 'ChopTree')!;

        const ws1 = lumberjackReadyToChopState();
        ws1.set('nearby.reachableTrees', 2);
        ws1.set('inv.logs', 0);

        const ws2 = lumberjackReadyToChopState();
        ws2.set('nearby.reachableTrees', 10);
        ws2.set('inv.logs', 0);

        expect(chopGoal.getUtility(ws2)).toBeGreaterThan(chopGoal.getUtility(ws1));
      });

      test('SPEC: 16+ logs = goal satisfied (utility 0)', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('inv.logs', 16);

        const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
        expect(chopGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: No trees = cannot chop', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('nearby.reachableTrees', 0);

        const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
        expect(chopGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: Full inventory = cannot chop', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('state.inventoryFull', true);

        const chopGoal = goals.find((g) => g.name === 'ChopTree')!;
        expect(chopGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Tree Harvest Completion', () => {
      test('SPEC: Mid-harvest should complete first (utility 85)', () => {
        const ws = lumberjackMidTreeHarvestState();

        arbiter.clearCurrentGoal();
        const result = arbiter.selectGoal(ws);

        expect(result?.goal.name).toBe('CompleteTreeHarvest');
        expect(result?.utility).toBe(85);
      });
    });

    describe('Sapling Planting', () => {
      test('SPEC: With saplings, should plant for sustainability', () => {
        const ws = lumberjackWithSaplingsState();
        ws.set('tree.active', false);

        const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
        expect(plantGoal.getUtility(ws)).toBeGreaterThan(0);
      });

      test('SPEC: More saplings = higher priority', () => {
        const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;

        const ws1 = lumberjackWithSaplingsState();
        ws1.set('inv.saplings', 2);
        ws1.set('tree.active', false);

        const ws2 = lumberjackWithSaplingsState();
        ws2.set('inv.saplings', 10);
        ws2.set('tree.active', false);

        expect(plantGoal.getUtility(ws2)).toBeGreaterThan(plantGoal.getUtility(ws1));
      });

      test('SPEC: No planting during active harvest', () => {
        const ws = lumberjackWithSaplingsState();
        ws.set('tree.active', true);

        const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
        expect(plantGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: No saplings = cannot plant', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('inv.saplings', 0);

        const plantGoal = goals.find((g) => g.name === 'PlantSaplings')!;
        expect(plantGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Wood Processing', () => {
      test('SPEC: Logs + low planks = should process (utility 50)', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('inv.logs', 8);
        ws.set('inv.planks', 0);

        const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
        expect(processGoal.getUtility(ws)).toBe(50);
      });

      test('SPEC: Enough planks = no processing', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('inv.logs', 8);
        ws.set('inv.planks', 8);

        const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
        expect(processGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: Too few logs = cannot process', () => {
        const ws = lumberjackReadyToChopState();
        ws.set('inv.logs', 1);
        ws.set('inv.planks', 0);

        const processGoal = goals.find((g) => g.name === 'ProcessWood')!;
        expect(processGoal.getUtility(ws)).toBe(0);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FARMER CORE WORK
  // ═══════════════════════════════════════════════════════════════════════════

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

      test('SPEC: More crops = higher utility', () => {
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
      test('SPEC: Low farmland triggers tilling (utility 50)', () => {
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

      test('SPEC: Cannot till without ability or farm', () => {
        const ws = farmerNeedsTillingState();
        ws.set('can.till', false);

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

      test('SPEC: Enough seeds = zero utility', () => {
        const ws = farmerGatheringSeedsState();
        ws.set('inv.seeds', 15);

        const seedGoal = goals.find((g) => g.name === 'GatherSeeds')!;
        expect(seedGoal.getUtility(ws)).toBe(0);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LANDSCAPER CORE WORK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Landscaper Core Work', () => {
    const goals = createLandscaperGoals();
    const arbiter = new GoalArbiter(goals);

    describe('Terraform Fulfillment', () => {
      test('SPEC: Pending request + both tools = high priority (100)', () => {
        const ws = landscaperWithTerraformRequestState();

        const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
        expect(terraformGoal.getUtility(ws)).toBe(100);
      });

      test('SPEC: Active terraform + both tools = highest priority (120)', () => {
        const ws = landscaperActiveTerraformState();

        const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
        expect(terraformGoal.getUtility(ws)).toBe(120);
      });

      test('SPEC: No pending request = zero utility', () => {
        const ws = landscaperIdleState();
        ws.set('has.pendingTerraformRequest', false);
        ws.set('terraform.active', false);

        const terraformGoal = goals.find((g) => g.name === 'FulfillTerraformRequest')!;
        expect(terraformGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Farm Checking', () => {
      test('SPEC: Farms needing check + tools = high priority', () => {
        const ws = landscaperWithFarmsToCheckState();

        const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
        expect(checkGoal.getUtility(ws)).toBeGreaterThan(60);
      });

      test('SPEC: No checking during active terraform', () => {
        const ws = landscaperActiveTerraformState();
        ws.set('state.farmsNeedingCheck', 3);

        const checkGoal = goals.find((g) => g.name === 'CheckKnownFarms')!;
        expect(checkGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Farm Maintenance', () => {
      test('SPEC: Farms with issues = high maintenance priority', () => {
        const ws = landscaperWithFarmMaintenanceState();

        const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
        expect(maintainGoal.getUtility(ws)).toBeGreaterThan(80);
      });

      test('SPEC: More farms with issues = higher priority', () => {
        const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;

        const ws1 = landscaperWithFarmMaintenanceState();
        ws1.set('state.farmsWithIssues', 1);

        const ws2 = landscaperWithFarmMaintenanceState();
        ws2.set('state.farmsWithIssues', 3);

        expect(maintainGoal.getUtility(ws2)).toBeGreaterThan(maintainGoal.getUtility(ws1));
      });

      test('SPEC: No dirt = cannot maintain', () => {
        const ws = landscaperWithFarmMaintenanceState();
        ws.set('inv.dirt', 0);

        const maintainGoal = goals.find((g) => g.name === 'MaintainFarms')!;
        expect(maintainGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Dirt Gathering', () => {
      test('SPEC: Low dirt when idle = gather', () => {
        const ws = landscaperIdleState();
        ws.set('inv.dirt', 16);
        ws.set('has.shovel', true);

        const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
        expect(gatherGoal.getUtility(ws)).toBeGreaterThan(30);
      });

      test('SPEC: Less dirt = higher priority', () => {
        const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;

        const ws1 = landscaperIdleState();
        ws1.set('inv.dirt', 50);
        ws1.set('has.shovel', true);

        const ws2 = landscaperIdleState();
        ws2.set('inv.dirt', 10);
        ws2.set('has.shovel', true);

        expect(gatherGoal.getUtility(ws2)).toBeGreaterThan(gatherGoal.getUtility(ws1));
      });

      test('SPEC: Enough dirt = zero utility', () => {
        const ws = landscaperIdleState();
        ws.set('inv.dirt', 64);
        ws.set('has.shovel', true);

        const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
        expect(gatherGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: No shovel = cannot gather', () => {
        const ws = landscaperIdleState();
        ws.set('inv.dirt', 10);
        ws.set('has.shovel', false);

        const gatherGoal = goals.find((g) => g.name === 'GatherDirt')!;
        expect(gatherGoal.getUtility(ws)).toBe(0);
      });
    });

    describe('Slab Crafting', () => {
      test('SPEC: Low slabs + planks = craft when idle', () => {
        const ws = landscaperIdleState();
        ws.set('inv.slabs', 4);
        ws.set('inv.planks', 12);

        const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
        expect(slabGoal.getUtility(ws)).toBeGreaterThan(20);
      });

      test('SPEC: Enough slabs = zero utility', () => {
        const ws = landscaperIdleState();
        ws.set('inv.slabs', 20);
        ws.set('inv.planks', 12);

        const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
        expect(slabGoal.getUtility(ws)).toBe(0);
      });

      test('SPEC: No planks = cannot craft', () => {
        const ws = landscaperIdleState();
        ws.set('inv.slabs', 4);
        ws.set('inv.planks', 1);

        const slabGoal = goals.find((g) => g.name === 'CraftSlabs')!;
        expect(slabGoal.getUtility(ws)).toBe(0);
      });
    });
  });
});
