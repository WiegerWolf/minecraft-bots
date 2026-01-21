/**
 * Debug script to test boat movement specifically
 * Run with: bun run tests/debug-boat-movement.ts
 */
import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'BoatMover',
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

bot.once('spawn', async () => {
  console.log('Bot spawned, setting up test environment...');
  await sleep(2000);

  // Give ourselves a boat and teleport to water
  bot.chat('/give BoatMover oak_boat 1');
  await sleep(500);
  bot.chat('/tp BoatMover 0 64 0');
  await sleep(500);
  bot.chat('/fill -5 63 -5 5 63 5 minecraft:water');
  await sleep(500);

  // Find and equip boat
  const boatItem = bot.inventory.items().find(i => i.name.includes('boat'));
  if (!boatItem) {
    console.log('ERROR: No boat');
    process.exit(1);
  }
  await bot.equip(boatItem, 'hand');
  await sleep(300);

  // Find water and place boat
  let waterBlock = null;
  for (let dz = 1; dz < 5; dz++) {
    const block = bot.blockAt(bot.entity.position.offset(0, -1, dz));
    if (block?.name === 'water') {
      waterBlock = block;
      break;
    }
  }
  if (!waterBlock) {
    console.log('ERROR: No water found');
    process.exit(1);
  }

  console.log('Placing boat on water...');
  await bot.lookAt(waterBlock.position.offset(0.5, 0.5, 0.5));
  await sleep(200);

  try {
    const boatEntity = await bot.placeEntity(waterBlock, new (require('vec3').Vec3)(0, 1, 0));
    console.log('Boat placed:', boatEntity?.id);

    // Mount the boat
    await bot.mount(boatEntity);
    await sleep(500);

    const botWithVehicle = bot as any;
    console.log('Mounted in vehicle:', botWithVehicle.vehicle?.name, 'id:', botWithVehicle.vehicle?.id);

    // Log initial position
    console.log('\n=== Testing boat movement ===');
    console.log('Initial position:', bot.entity.position.toString());

    // Check what feature is being used
    const client = (bot as any)._client;
    const hasNewPacket = bot.supportFeature('newPlayerInputPacket');
    console.log('Using newPlayerInputPacket:', hasNewPacket);
    console.log('Protocol version:', client.protocolVersion);

    // Test 1: moveVehicle API
    console.log('\n--- Test 1: bot.moveVehicle(0, 1) for 3 seconds ---');
    const startPos1 = bot.entity.position.clone();
    for (let i = 0; i < 30; i++) {
      bot.moveVehicle(0, 1);
      await sleep(100);
    }
    console.log('Position after moveVehicle:', bot.entity.position.toString());
    console.log('Distance moved:', startPos1.distanceTo(bot.entity.position).toFixed(2));

    // Test 2: setControlState
    console.log('\n--- Test 2: setControlState("forward", true) for 3 seconds ---');
    const startPos2 = bot.entity.position.clone();
    bot.setControlState('forward', true);
    await sleep(3000);
    bot.setControlState('forward', false);
    console.log('Position after setControlState:', bot.entity.position.toString());
    console.log('Distance moved:', startPos2.distanceTo(bot.entity.position).toFixed(2));

    // Test 3: Direct packet write (old steer_vehicle format)
    console.log('\n--- Test 3: Direct steer_vehicle packet for 3 seconds ---');
    const startPos3 = bot.entity.position.clone();
    for (let i = 0; i < 30; i++) {
      try {
        client.write('steer_vehicle', {
          sideways: 0,
          forward: 1,
          jump: 0x01
        });
      } catch (e: any) {
        if (i === 0) console.log('steer_vehicle error:', e.message);
      }
      await sleep(100);
    }
    console.log('Position after steer_vehicle:', bot.entity.position.toString());
    console.log('Distance moved:', startPos3.distanceTo(bot.entity.position).toFixed(2));

    // Test 4: Direct player_input packet
    console.log('\n--- Test 4: Direct player_input packet for 3 seconds ---');
    const startPos4 = bot.entity.position.clone();
    for (let i = 0; i < 30; i++) {
      try {
        client.write('player_input', {
          inputs: {
            forward: true,
            backward: false,
            left: false,
            right: false,
            jump: false,
            shift: false,
            sprint: false
          }
        });
      } catch (e: any) {
        if (i === 0) console.log('player_input error:', e.message);
      }
      await sleep(100);
    }
    console.log('Position after player_input:', bot.entity.position.toString());
    console.log('Distance moved:', startPos4.distanceTo(bot.entity.position).toFixed(2));

    console.log('\n=== Done ===');

  } catch (err: any) {
    console.log('Error:', err.message);
  }

  await sleep(2000);
  process.exit(0);
});

bot.on('error', (err) => console.error('Bot error:', err));
bot.on('kicked', (reason) => {
  console.log('Kicked:', reason);
  process.exit(1);
});
