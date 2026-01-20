/**
 * ScenarioBuilder - Fluent API for building simulation worlds.
 *
 * Makes it easy to create complex test scenarios with readable code.
 *
 * Usage:
 * ```typescript
 * const { world, botConfig } = new ScenarioBuilder()
 *   .ground('grass_block', 30)
 *   .forest({ center: new Vec3(20, 64, 20), trees: 5 })
 *   .structure('hut', new Vec3(-10, 64, -10))
 *   .villageSign(new Vec3(0, 64, 0))
 *   .chest(new Vec3(5, 64, 0))
 *   .bot({
 *     position: new Vec3(0, 65, 0),
 *     inventory: [{ name: 'iron_axe', count: 1 }],
 *   })
 *   .build();
 * ```
 */

import { Vec3 } from 'vec3';
import { MockWorld, createOakTree, createBirchTree, createStump } from '../mocks/MockWorld';

export interface BotConfig {
  position: Vec3;
  inventory: Array<{ name: string; count: number }>;
  gameMode: 'survival' | 'creative';
}

export interface ScenarioResult {
  world: MockWorld;
  botConfig: BotConfig;
  description: string[];
}

export class ScenarioBuilder {
  private world: MockWorld;
  private botConfig: BotConfig;
  private descriptionLines: string[] = [];

  constructor() {
    this.world = new MockWorld();
    this.botConfig = {
      position: new Vec3(0, 65, 0),
      inventory: [],
      gameMode: 'survival',
    };
  }

  /**
   * Add a flat ground layer.
   */
  ground(block: string = 'grass_block', radius: number = 30, y: number = 63): this {
    this.world.fill(
      new Vec3(-radius, y, -radius),
      new Vec3(radius, y, radius),
      block
    );
    // Add bedrock below
    this.world.fill(
      new Vec3(-radius, y - 1, -radius),
      new Vec3(radius, y - 1, radius),
      'bedrock'
    );
    this.descriptionLines.push(`Ground: ${block} (${radius * 2 + 1}x${radius * 2 + 1})`);
    return this;
  }

  /**
   * Add a forest cluster.
   */
  forest(options: {
    center: Vec3;
    trees?: number;
    radius?: number;
    type?: 'oak' | 'birch' | 'mixed';
  }): this {
    const { center, trees = 5, radius = 10, type = 'oak' } = options;
    const createTree = type === 'birch' ? createBirchTree :
                       type === 'mixed' ? (w: MockWorld, p: Vec3, h: number) =>
                         Math.random() > 0.5 ? createOakTree(w, p, h) : createBirchTree(w, p, h) :
                       createOakTree;

    // Place trees in a rough cluster
    for (let i = 0; i < trees; i++) {
      const angle = (i / trees) * Math.PI * 2 + Math.random() * 0.5;
      const dist = Math.random() * radius;
      const x = Math.floor(center.x + Math.cos(angle) * dist);
      const z = Math.floor(center.z + Math.sin(angle) * dist);
      const height = 4 + Math.floor(Math.random() * 3);
      createTree(this.world, new Vec3(x, center.y, z), height);
    }

    this.descriptionLines.push(`Forest: ${trees} ${type} trees near (${center.x}, ${center.z})`);
    return this;
  }

  /**
   * Add a single tree.
   */
  tree(pos: Vec3, type: 'oak' | 'birch' = 'oak', height?: number): this {
    const h = height ?? (type === 'birch' ? 7 : 5);
    if (type === 'birch') {
      createBirchTree(this.world, pos, h);
    } else {
      createOakTree(this.world, pos, h);
    }
    this.descriptionLines.push(`Tree: ${type} at (${pos.x}, ${pos.y}, ${pos.z})`);
    return this;
  }

  /**
   * Add a stump (harvested tree).
   */
  stump(pos: Vec3, type: 'oak' | 'birch' = 'oak'): this {
    createStump(this.world, pos, type === 'birch' ? 'birch_log' : 'oak_log');
    this.descriptionLines.push(`Stump: ${type} at (${pos.x}, ${pos.y}, ${pos.z})`);
    return this;
  }

  /**
   * Add a village center sign.
   */
  villageSign(pos: Vec3): this {
    this.world.setBlock(pos, 'oak_sign', { signText: 'VILLAGE CENTER' });
    this.descriptionLines.push(`Village Sign: at (${pos.x}, ${pos.y}, ${pos.z})`);
    return this;
  }

  /**
   * Add a FARM sign.
   */
  farmSign(pos: Vec3, farmCenter: Vec3): this {
    this.world.setBlock(pos, 'oak_sign', {
      signText: `FARM\n${farmCenter.x}, ${farmCenter.y}, ${farmCenter.z}`,
    });
    this.descriptionLines.push(`Farm Sign: at (${pos.x}, ${pos.y}, ${pos.z}) -> (${farmCenter.x}, ${farmCenter.z})`);
    return this;
  }

  /**
   * Add a chest.
   */
  chest(pos: Vec3): this {
    this.world.setBlock(pos, 'chest');
    this.descriptionLines.push(`Chest: at (${pos.x}, ${pos.y}, ${pos.z})`);
    return this;
  }

  /**
   * Add a crafting table.
   */
  craftingTable(pos: Vec3): this {
    this.world.setBlock(pos, 'crafting_table');
    this.descriptionLines.push(`Crafting Table: at (${pos.x}, ${pos.y}, ${pos.z})`);
    return this;
  }

  /**
   * Add farmland with crops.
   */
  farm(options: {
    corner: Vec3;
    width?: number;
    length?: number;
    crop?: 'wheat' | 'carrots' | 'potatoes';
    mature?: boolean;
  }): this {
    const { corner, width = 9, length = 9, crop = 'wheat', mature = true } = options;

    // Water in the center
    const centerX = Math.floor(corner.x + width / 2);
    const centerZ = Math.floor(corner.z + length / 2);
    this.world.setBlock(new Vec3(centerX, corner.y - 1, centerZ), 'water');

    // Farmland and crops
    // Mature age for each crop type: wheat=7, carrots=7, potatoes=7
    const maxAge = 7;
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < length; dz++) {
        const x = corner.x + dx;
        const z = corner.z + dz;
        if (x === centerX && z === centerZ) continue; // Skip water

        this.world.setBlock(new Vec3(x, corner.y, z), 'farmland');
        const cropBlock = mature ? `${crop}[age=${maxAge}]` : crop;
        this.world.setBlock(new Vec3(x, corner.y + 1, z), cropBlock);
      }
    }

    this.descriptionLines.push(`Farm: ${width}x${length} ${crop} at (${corner.x}, ${corner.z})`);
    return this;
  }

  /**
   * Add a pre-built structure.
   */
  structure(type: 'hut' | 'platform' | 'wall', pos: Vec3): this {
    switch (type) {
      case 'hut':
        // Simple 5x5 hut with walls
        this.world.fill(pos, pos.offset(4, 0, 4), 'oak_planks');
        // Walls
        for (let y = 1; y <= 2; y++) {
          for (let i = 0; i <= 4; i++) {
            this.world.setBlock(pos.offset(i, y, 0), 'oak_planks');
            this.world.setBlock(pos.offset(i, y, 4), 'oak_planks');
            this.world.setBlock(pos.offset(0, y, i), 'oak_planks');
            this.world.setBlock(pos.offset(4, y, i), 'oak_planks');
          }
        }
        // Door opening
        this.world.setBlock(pos.offset(2, 1, 0), 'air');
        this.world.setBlock(pos.offset(2, 2, 0), 'air');
        this.descriptionLines.push(`Hut: at (${pos.x}, ${pos.y}, ${pos.z})`);
        break;

      case 'platform':
        this.world.fill(pos, pos.offset(5, 0, 5), 'oak_planks');
        // Corner posts
        this.world.setBlock(pos.offset(0, 1, 0), 'oak_log');
        this.world.setBlock(pos.offset(5, 1, 0), 'oak_log');
        this.world.setBlock(pos.offset(0, 1, 5), 'oak_log');
        this.world.setBlock(pos.offset(5, 1, 5), 'oak_log');
        this.descriptionLines.push(`Platform: at (${pos.x}, ${pos.y}, ${pos.z})`);
        break;

      case 'wall':
        for (let x = 0; x < 10; x++) {
          for (let y = 0; y < 3; y++) {
            this.world.setBlock(pos.offset(x, y, 0), 'cobblestone');
          }
        }
        this.descriptionLines.push(`Wall: at (${pos.x}, ${pos.y}, ${pos.z})`);
        break;
    }
    return this;
  }

  /**
   * Set a single block.
   */
  block(pos: Vec3, name: string, options?: { signText?: string }): this {
    this.world.setBlock(pos, name, options);
    return this;
  }

  /**
   * Fill a region with blocks.
   */
  fill(from: Vec3, to: Vec3, block: string): this {
    this.world.fill(from, to, block);
    return this;
  }

  /**
   * Configure the bot.
   */
  bot(config: Partial<BotConfig>): this {
    this.botConfig = { ...this.botConfig, ...config };
    return this;
  }

  /**
   * Give the bot items.
   */
  giveItems(items: Array<{ name: string; count: number }>): this {
    this.botConfig.inventory.push(...items);
    return this;
  }

  /**
   * Build the scenario.
   */
  build(): ScenarioResult {
    return {
      world: this.world,
      botConfig: this.botConfig,
      description: this.descriptionLines,
    };
  }

  /**
   * Print the scenario description.
   */
  describe(): void {
    console.log('Scenario:');
    for (const line of this.descriptionLines) {
      console.log(`  • ${line}`);
    }
    console.log(`  • Bot at (${this.botConfig.position.x}, ${this.botConfig.position.y}, ${this.botConfig.position.z})`);
    if (this.botConfig.inventory.length > 0) {
      console.log(`  • Inventory: ${this.botConfig.inventory.map(i => `${i.name} x${i.count}`).join(', ')}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESET SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Basic lumberjack scenario: forest, stumps, village sign, chest.
 */
export function lumberjackScenario(): ScenarioResult {
  return new ScenarioBuilder()
    .ground('grass_block', 35)
    .villageSign(new Vec3(0, 64, 0))
    .forest({ center: new Vec3(20, 64, 20), trees: 5 })
    .stump(new Vec3(-10, 64, 5))
    .stump(new Vec3(-8, 64, 8))
    .structure('platform', new Vec3(-15, 64, -15))
    .chest(new Vec3(3, 64, -2))
    .bot({
      position: new Vec3(0, 65, 0),
      inventory: [{ name: 'iron_axe', count: 1 }],
      gameMode: 'survival',
    })
    .build();
}

/**
 * Farmer scenario: farmland, crops, water, storage.
 */
export function farmerScenario(): ScenarioResult {
  return new ScenarioBuilder()
    .ground('grass_block', 30)
    .villageSign(new Vec3(0, 64, 0))
    .farmSign(new Vec3(2, 64, 0), new Vec3(10, 63, 10))
    .farm({ corner: new Vec3(5, 63, 5), width: 9, length: 9, crop: 'wheat', mature: true })
    .chest(new Vec3(-3, 64, 0))
    .craftingTable(new Vec3(-3, 64, 2))
    .bot({
      position: new Vec3(0, 65, 0),
      inventory: [
        { name: 'iron_hoe', count: 1 },
        { name: 'wheat_seeds', count: 32 },
      ],
      gameMode: 'survival',
    })
    .build();
}

/**
 * Mixed scenario for testing multiple behaviors.
 */
export function mixedScenario(): ScenarioResult {
  return new ScenarioBuilder()
    .ground('grass_block', 40)
    .villageSign(new Vec3(0, 64, 0))
    // Forest in one corner
    .forest({ center: new Vec3(25, 64, 25), trees: 6 })
    // Farm in another corner
    .farm({ corner: new Vec3(-20, 63, 15), width: 7, length: 7 })
    .farmSign(new Vec3(-15, 64, 12), new Vec3(-17, 63, 18))
    // Storage area
    .chest(new Vec3(5, 64, -5))
    .chest(new Vec3(7, 64, -5))
    .craftingTable(new Vec3(5, 64, -7))
    // Structure to avoid
    .structure('hut', new Vec3(-10, 64, -20))
    .bot({
      position: new Vec3(0, 65, 0),
      inventory: [],
      gameMode: 'survival',
    })
    .build();
}

/**
 * Landscaper scenario: terraform area, dirt sources, tools.
 */
export function landscaperScenario(): ScenarioResult {
  return new ScenarioBuilder()
    .ground('grass_block', 35)
    .villageSign(new Vec3(0, 64, 0))
    // Uneven terrain that needs terraforming
    .fill(new Vec3(15, 64, 15), new Vec3(20, 65, 20), 'dirt')
    .fill(new Vec3(15, 63, 15), new Vec3(20, 63, 20), 'dirt') // Support layer
    // Water for farm center
    .block(new Vec3(17, 63, 17), 'water')
    .farmSign(new Vec3(2, 64, 0), new Vec3(17, 63, 17))
    // Dirtpit sign for gathering
    .block(new Vec3(4, 64, 0), 'oak_sign', { signText: 'DIRTPIT\n-20, 63, -20' })
    .fill(new Vec3(-25, 63, -25), new Vec3(-15, 63, -15), 'dirt') // Dirtpit area
    // Storage and crafting
    .chest(new Vec3(-5, 64, 0))
    .craftingTable(new Vec3(-5, 64, 2))
    .bot({
      position: new Vec3(0, 65, 0),
      inventory: [
        { name: 'iron_shovel', count: 1 },
        { name: 'iron_pickaxe', count: 1 },
        { name: 'dirt', count: 32 },
      ],
      gameMode: 'survival',
    })
    .build();
}

/**
 * Multi-bot trading scenario: shared infrastructure and trading items.
 */
export function tradingScenario(): ScenarioResult {
  return new ScenarioBuilder()
    .ground('grass_block', 40)
    .villageSign(new Vec3(0, 64, 0))
    // Shared storage
    .chest(new Vec3(5, 64, 0))
    .craftingTable(new Vec3(5, 64, 2))
    .block(new Vec3(2, 64, 0), 'oak_sign', { signText: 'CHEST\n5, 64, 0' })
    .block(new Vec3(4, 64, 0), 'oak_sign', { signText: 'CRAFT\n5, 64, 2' })
    // Forest for lumberjack
    .forest({ center: new Vec3(25, 64, 0), trees: 5 })
    // Farm for farmer
    .block(new Vec3(-15, 63, 15), 'water')
    .farmSign(new Vec3(6, 64, 0), new Vec3(-15, 63, 15))
    .bot({
      position: new Vec3(0, 65, 0),
      inventory: [],
      gameMode: 'survival',
    })
    .build();
}

/**
 * Fresh spawn scenario: minimal infrastructure, bot must build everything.
 */
export function freshSpawnScenario(): ScenarioResult {
  return new ScenarioBuilder()
    .ground('grass_block', 50)
    // Just a village center, no other infrastructure
    .villageSign(new Vec3(0, 64, 0))
    // Scatter some grass for seeds
    .fill(new Vec3(-10, 64, -10), new Vec3(10, 64, 10), 'short_grass')
    // One water source
    .block(new Vec3(20, 63, 20), 'water')
    // Small forest
    .forest({ center: new Vec3(-25, 64, -25), trees: 4 })
    .bot({
      position: new Vec3(0, 65, 0),
      inventory: [],
      gameMode: 'survival',
    })
    .build();
}
