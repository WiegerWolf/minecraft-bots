/**
 * Debug script to test boat placement in mineflayer
 * Run with: bun run tests/debug-boat.ts
 */
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'BoatTester',
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

bot.once('spawn', async () => {
  console.log('Bot spawned, waiting for world to load...');
  await sleep(2000);

  // Give ourselves a boat
  bot.chat('/give BoatTester oak_boat 1');
  await sleep(1000);

  // Teleport to a water location (adjust coordinates as needed)
  bot.chat('/tp BoatTester 0 64 10');
  await sleep(1000);

  // Create some water in front of us
  bot.chat('/fill 0 63 15 5 63 20 minecraft:water');
  await sleep(500);

  console.log('\n=== Testing boat placement methods ===\n');

  // Find boat in inventory
  const boatItem = bot.inventory.items().find(i => i.name.includes('boat'));
  if (!boatItem) {
    console.log('ERROR: No boat in inventory');
    process.exit(1);
  }
  console.log('Found boat:', boatItem.name);

  // Equip the boat
  await bot.equip(boatItem, 'hand');
  await sleep(300);
  console.log('Equipped boat, held item:', bot.heldItem?.name);

  // Find nearby water
  const pos = bot.entity.position;
  let waterBlock: any = null;
  for (let dz = 1; dz < 10; dz++) {
    const checkPos = pos.offset(0, -1, dz);
    const block = bot.blockAt(checkPos);
    if (block && (block.name === 'water' || block.name === 'flowing_water')) {
      waterBlock = block;
      console.log('Found water at:', block.position.toString());
      break;
    }
  }

  if (!waterBlock) {
    console.log('ERROR: No water found');
    process.exit(1);
  }

  // Look at the water
  await bot.lookAt(waterBlock.position.offset(0.5, 1, 0.5));
  await sleep(200);
  console.log('Looking at water surface');

  // Method 1: Try placeEntity
  console.log('\n--- Method 1: bot.placeEntity(waterBlock, Vec3(0, 1, 0)) ---');
  try {
    const entity = await bot.placeEntity(waterBlock, new Vec3(0, 1, 0));
    console.log('placeEntity returned:', entity);
  } catch (err: any) {
    console.log('placeEntity error:', err.message);
  }
  await sleep(1000);
  checkForBoatEntity();

  // Re-equip boat if needed
  const boatItem2 = bot.inventory.items().find(i => i.name.includes('boat'));
  if (boatItem2) {
    await bot.equip(boatItem2, 'hand');
    await sleep(300);
  } else {
    bot.chat('/give BoatTester oak_boat 1');
    await sleep(500);
    const newBoat = bot.inventory.items().find(i => i.name.includes('boat'));
    if (newBoat) await bot.equip(newBoat, 'hand');
    await sleep(300);
  }

  // Method 2: Try activateBlock
  console.log('\n--- Method 2: bot.activateBlock(waterBlock) ---');
  try {
    await bot.activateBlock(waterBlock);
    console.log('activateBlock completed');
  } catch (err: any) {
    console.log('activateBlock error:', err.message);
  }
  await sleep(1000);
  checkForBoatEntity();

  // Re-equip boat
  bot.chat('/give BoatTester oak_boat 1');
  await sleep(500);
  const newBoat2 = bot.inventory.items().find(i => i.name.includes('boat'));
  if (newBoat2) await bot.equip(newBoat2, 'hand');
  await sleep(300);

  // Method 3: Try activateItem (while looking at water)
  console.log('\n--- Method 3: bot.activateItem() while looking at water ---');
  await bot.lookAt(waterBlock.position.offset(0.5, 0.5, 0.5));
  await sleep(200);
  try {
    bot.activateItem();
    console.log('activateItem called');
  } catch (err: any) {
    console.log('activateItem error:', err.message);
  }
  await sleep(1000);
  checkForBoatEntity();

  // Re-equip boat
  bot.chat('/give BoatTester oak_boat 1');
  await sleep(500);
  const newBoat3 = bot.inventory.items().find(i => i.name.includes('boat'));
  if (newBoat3) await bot.equip(newBoat3, 'hand');
  await sleep(300);

  // Method 4: Try placing on block NEXT to water (shore)
  console.log('\n--- Method 4: bot.placeEntity on shore block looking at water ---');
  const shoreBlock = bot.blockAt(waterBlock.position.offset(0, 0, -1));
  if (shoreBlock && shoreBlock.name !== 'water') {
    console.log('Shore block:', shoreBlock.name, 'at', shoreBlock.position.toString());
    await bot.lookAt(waterBlock.position.offset(0.5, 1, 0.5));
    await sleep(200);
    try {
      // Place entity on shore facing toward water
      const entity = await bot.placeEntity(shoreBlock, new Vec3(0, 0, 1));
      console.log('placeEntity on shore returned:', entity);
    } catch (err: any) {
      console.log('placeEntity on shore error:', err.message);
    }
    await sleep(1000);
    checkForBoatEntity();
  }

  // Method 5: Walk into water and use item
  console.log('\n--- Method 5: Walk into water, then activateItem ---');
  bot.chat('/give BoatTester oak_boat 1');
  await sleep(500);
  const newBoat4 = bot.inventory.items().find(i => i.name.includes('boat'));
  if (newBoat4) await bot.equip(newBoat4, 'hand');
  await sleep(300);

  // Walk forward into water
  bot.setControlState('forward', true);
  await sleep(800);
  bot.setControlState('forward', false);
  console.log('Now in water at:', bot.entity.position.toString());

  // Look down at water surface
  await bot.look(0, -0.5); // Look slightly down
  await sleep(200);

  try {
    bot.activateItem();
    console.log('activateItem in water called');
  } catch (err: any) {
    console.log('activateItem in water error:', err.message);
  }
  await sleep(1000);
  checkForBoatEntity();

  console.log('\n=== Done testing ===');
  await sleep(2000);
  process.exit(0);

  function checkForBoatEntity() {
    let found = false;
    for (const entity of Object.values(bot.entities)) {
      if (entity.name?.includes('boat')) {
        console.log('✓ FOUND BOAT ENTITY:', entity.name, 'at', entity.position?.toString(), 'id:', entity.id);
        found = true;
      }
    }
    if (!found) {
      console.log('✗ No boat entity found nearby');
    }
  }
});

bot.on('error', (err) => {
  console.error('Bot error:', err);
});

bot.on('kicked', (reason) => {
  console.log('Kicked:', reason);
  process.exit(1);
});
