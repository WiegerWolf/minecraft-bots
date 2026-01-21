/**
 * Boat placement and navigation utilities.
 *
 * This module provides a workaround for Minecraft 1.21+ where the use_item
 * packet format changed from `rotation: { x, y }` to separate `yaw` and `pitch` fields.
 * Mineflayer 4.33.0 still uses the old format, causing boat placement to fail.
 *
 * @see https://github.com/PrismarineJS/mineflayer/issues/3742
 */

import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Finds the nearest boat entity within a given radius.
 */
export function findNearbyBoat(bot: Bot, maxDistance: number = 5): Entity | null {
  for (const entity of Object.values(bot.entities)) {
    if (entity.name?.includes('boat') && entity.position.distanceTo(bot.entity.position) < maxDistance) {
      return entity;
    }
  }
  return null;
}

/**
 * Finds a suitable water block near the bot for placing a boat.
 * Returns the nearest water block that has air above it.
 */
export function findNearbyWaterBlock(bot: Bot, searchRadius: number = 5): any | null {
  const pos = bot.entity.position;
  let nearestBlock: any = null;
  let nearestDist = Infinity;

  // Search in a sphere, prioritizing closer blocks
  for (let dist = 1; dist <= searchRadius; dist++) {
    for (let dx = -dist; dx <= dist; dx++) {
      for (let dz = -dist; dz <= dist; dz++) {
        for (let dy = -2; dy <= 1; dy++) {
          const checkPos = pos.offset(dx, dy, dz);
          const block = bot.blockAt(checkPos);
          if (block && (block.name === 'water' || block.name === 'flowing_water')) {
            // Verify there's air above for the boat
            const above = bot.blockAt(checkPos.offset(0, 1, 0));
            if (above && above.name === 'air') {
              const blockDist = pos.distanceTo(checkPos);
              if (blockDist < nearestDist) {
                nearestDist = blockDist;
                nearestBlock = block;
              }
            }
          }
        }
      }
    }
    // If we found water at this distance, return it
    if (nearestBlock) {
      return nearestBlock;
    }
  }
  return null;
}

/**
 * Sends a use_item packet with the correct format for the Minecraft version.
 * This is a workaround for the mineflayer 1.21+ bug.
 *
 * @param bot - The bot instance
 * @param offHand - Whether to use the off-hand (default: false)
 * @param log - Optional logger for debugging
 */
export function sendUseItemPacket(bot: Bot, offHand: boolean = false, log?: { debug: Function }): void {
  const client = (bot as any)._client;

  // Get the current yaw and pitch
  const yawDeg = -bot.entity.yaw * 180 / Math.PI + 180; // invert + shift
  const pitchDeg = -bot.entity.pitch * 180 / Math.PI; // invert

  // Mineflayer uses a sequence number for packet ordering
  const sequence = Date.now() % 10000;

  // Check protocol version - 767 = 1.21
  // protocolVersion might be stored in different places depending on mineflayer version
  const protocolVersion = client.protocolVersion ?? client.version?.protocolVersion ?? 0;
  const mcVersion = client.version;

  // For MC 1.21+, we need the new packet format with separate yaw/pitch fields
  // Also check version string as fallback
  const versionStr = typeof mcVersion === 'string' ? mcVersion : mcVersion?.version ?? '';
  const is121Plus = protocolVersion >= 767 || versionStr.startsWith('1.21') || versionStr.startsWith('1.22');
  const useNewFormat = is121Plus;

  log?.debug({
    protocolVersion,
    versionStr,
    is121Plus,
    useNewFormat,
    yawDeg: yawDeg.toFixed(2),
    pitchDeg: pitchDeg.toFixed(2),
    hand: offHand ? 1 : 0,
    sequence,
  }, 'Sending use_item packet');

  // The minecraft-data schema for use_item still expects rotation: {x, y} format
  // even for 1.21+, because the fix hasn't been merged yet
  // So we use the old format regardless of version
  try {
    client.write('use_item', {
      hand: offHand ? 1 : 0,
      sequence,
      rotation: {
        x: yawDeg,
        y: pitchDeg,
      },
    });
    log?.debug('use_item packet sent successfully');
  } catch (err) {
    log?.debug({ err }, 'Error sending use_item packet');
    // Try the old mineflayer method as ultimate fallback
    try {
      bot.activateItem(offHand);
      log?.debug('Fallback to bot.activateItem');
    } catch (err2) {
      log?.debug({ err: err2 }, 'bot.activateItem also failed');
    }
  }
}

/**
 * Places a boat on water and returns the spawned boat entity.
 *
 * Tries multiple methods in order:
 * 1. mineflayer's placeEntity (standard approach)
 * 2. Direct use_item packet (workaround for 1.21+ bug)
 * 3. activateItem while in water
 *
 * @param bot - The bot instance
 * @param waterBlock - Optional specific water block to place on (finds one if not provided)
 * @param timeout - Maximum time to wait for boat spawn (default: 3000ms)
 * @param log - Optional logger for debugging
 * @returns The boat entity or null if placement failed
 */
export async function placeBoatOnWater(
  bot: Bot,
  waterBlock?: any,
  timeout: number = 3000,
  log?: { debug: Function; warn: Function }
): Promise<Entity | null> {
  // Find boat in inventory
  const boatItem = bot.inventory.items().find(i => i.name.includes('boat'));
  if (!boatItem) {
    log?.warn('No boat in inventory');
    return null;
  }
  log?.debug({ boatItem: boatItem.name }, 'Found boat in inventory');

  // Find water if not provided
  if (!waterBlock) {
    waterBlock = findNearbyWaterBlock(bot);
  }
  if (!waterBlock) {
    log?.warn('No water block found nearby');
    return null;
  }
  log?.debug({ waterPos: waterBlock.position.toString() }, 'Found water block');

  // Equip the boat
  await bot.equip(boatItem, 'hand');
  await sleep(200);

  // Verify boat is equipped
  if (!bot.heldItem || !bot.heldItem.name.includes('boat')) {
    log?.warn({ heldItem: bot.heldItem?.name }, 'Failed to equip boat');
    return null;
  }
  log?.debug({ heldItem: bot.heldItem.name }, 'Boat equipped');

  // Look down at the water surface (not above it)
  // The water block is at Y=63, so we look at Y=63.5 to look slightly down
  const lookTarget = waterBlock.position.offset(0.5, 0.5, 0.5);
  await bot.lookAt(lookTarget);
  await sleep(100);
  log?.debug({
    lookTarget: lookTarget.toString(),
    botPos: bot.entity.position.toString(),
    yaw: bot.entity.yaw.toFixed(2),
    pitch: bot.entity.pitch.toFixed(2),
  }, 'Looking at water');

  // Set up listener for boat spawn BEFORE calling placeEntity
  let spawnedBoat: Entity | null = null;
  const boatSpawnPromise = new Promise<Entity | null>((resolve) => {
    const timeoutId = setTimeout(() => {
      bot.off('entitySpawn', listener);
      resolve(null);
    }, timeout);

    function listener(entity: Entity) {
      log?.debug({ entityName: entity.name, entityPos: entity.position?.toString() }, 'Entity spawned');
      if (entity.name?.includes('boat')) {
        clearTimeout(timeoutId);
        bot.off('entitySpawn', listener);
        spawnedBoat = entity;
        log?.debug({ boatId: entity.id }, 'Boat entity detected via spawn event!');
        resolve(entity);
      }
    }

    bot.on('entitySpawn', listener);
  });

  // Method 1: Try mineflayer's placeEntity (now patched to work with 1.21+)
  // Don't await - let it run while we also listen for the spawn event
  log?.debug('Method 1: Trying bot.placeEntity...');
  const placeEntityPromise = bot.placeEntity(waterBlock, new Vec3(0, 1, 0)).catch((err: any) => {
    log?.debug({ error: err.message }, 'placeEntity failed');
    return null;
  });

  // Race: either placeEntity returns the boat, or our spawn listener catches it
  const result = await Promise.race([
    placeEntityPromise,
    boatSpawnPromise,
  ]);

  if (result) {
    log?.debug({ boatId: result.id }, 'Got boat from race');
    return result;
  }

  // Wait a bit more for the boat to appear via spawn event
  await sleep(500);
  if (spawnedBoat) {
    log?.debug({ boatId: spawnedBoat.id }, 'Got boat from spawn listener');
    return spawnedBoat;
  }

  // Check if boat spawned somewhere nearby
  let boatEntity = findNearbyBoat(bot, 8);
  if (boatEntity) {
    log?.debug({ boatId: boatEntity.id }, 'Found boat nearby after placement');
    return boatEntity;
  }

  // Re-equip boat if needed
  const boatItem2 = bot.inventory.items().find(i => i.name.includes('boat'));
  if (boatItem2 && (!bot.heldItem || !bot.heldItem.name.includes('boat'))) {
    await bot.equip(boatItem2, 'hand');
    await sleep(200);
    await bot.lookAt(waterBlock.position.offset(0.5, 1, 0.5));
    await sleep(100);
  }

  // Method 2: Send use_item packet directly (fallback)
  log?.debug('Method 2: Sending use_item packet...');
  sendUseItemPacket(bot, false, log);
  await sleep(1000);

  // Check if boat spawned
  boatEntity = findNearbyBoat(bot, 8);
  if (boatEntity) {
    log?.debug({ boatId: boatEntity.id }, 'Found boat after use_item packet');
    return boatEntity;
  }

  // Re-equip boat if needed
  const boatItem3 = bot.inventory.items().find(i => i.name.includes('boat'));
  if (boatItem3 && (!bot.heldItem || !bot.heldItem.name.includes('boat'))) {
    await bot.equip(boatItem3, 'hand');
    await sleep(200);
  }

  // Method 3: Step into water and use activateItem
  log?.debug('Method 3: Stepping into water and using activateItem...');
  bot.setControlState('forward', true);
  await sleep(500);
  bot.setControlState('forward', false);
  await sleep(100);

  // Look down at the water we're standing in
  await bot.look(bot.entity.yaw, Math.PI / 4); // Look down 45 degrees
  await sleep(100);

  try {
    bot.activateItem(false);
    log?.debug('activateItem called');
  } catch (err: any) {
    log?.debug({ error: err.message }, 'activateItem failed');
  }
  await sleep(1000);

  // Final check for boat
  boatEntity = findNearbyBoat(bot, 8);
  if (boatEntity) {
    log?.debug({ boatId: boatEntity.id }, 'Found boat after stepping into water');
    return boatEntity;
  }

  log?.debug('All boat placement methods failed');
  return null;
}

/**
 * Places a boat, mounts it, and prepares for navigation.
 *
 * @param bot - The bot instance
 * @param log - Optional logger for debug output
 * @returns True if successfully mounted, false otherwise
 */
export async function placeAndMountBoat(
  bot: Bot,
  log?: { debug: Function; warn: Function; info: Function }
): Promise<boolean> {
  log?.debug('Attempting to place boat');

  // Try placing the boat
  let boatEntity = await placeBoatOnWater(bot);

  // Retry with stepping into water if first attempt failed
  if (!boatEntity) {
    log?.debug('First placement attempt failed, stepping toward water');

    // Walk forward briefly toward water
    bot.setControlState('forward', true);
    await sleep(500);
    bot.setControlState('forward', false);
    await sleep(200);

    // Try again
    boatEntity = await placeBoatOnWater(bot);
  }

  if (!boatEntity) {
    log?.warn('Could not place boat');
    return false;
  }

  log?.debug({ boatId: boatEntity.id, pos: boatEntity.position.toString() }, 'Boat placed, mounting');

  // Mount the boat
  try {
    await bot.mount(boatEntity);
    await sleep(300);
  } catch (err) {
    log?.warn({ err }, 'Failed to mount boat');
    return false;
  }

  // Verify we're mounted
  const botWithVehicle = bot as Bot & { vehicle?: Entity };
  if (!botWithVehicle.vehicle) {
    log?.warn('Not in vehicle after mount attempt');
    return false;
  }

  log?.info('Successfully mounted boat');
  return true;
}

/**
 * Navigates a boat toward a destination using vehicle controls.
 *
 * @param bot - The bot instance
 * @param destination - Target position
 * @param maxTime - Maximum navigation time in ms (default: 30000)
 * @param log - Optional logger
 * @returns True if reached destination area, false if timed out or stuck
 */
export async function navigateBoatToward(
  bot: Bot,
  destination: Vec3,
  maxTime: number = 30000,
  log?: { debug: Function }
): Promise<boolean> {
  const startTime = Date.now();
  const startPos = bot.entity.position.clone();
  let lastProgressTime = startTime;
  let lastDistance = bot.entity.position.xzDistanceTo(destination);

  log?.debug({
    startPos: startPos.toString(),
    destination: destination.toString(),
    initialDist: lastDistance.toFixed(1),
  }, 'Starting boat navigation');

  while (Date.now() - startTime < maxTime) {
    const currentPos = bot.entity.position;
    const distToTarget = currentPos.xzDistanceTo(destination);

    // Check if we're close enough
    if (distToTarget < 15) {
      stopBoat(bot);
      log?.debug({ dist: distToTarget.toFixed(1) }, 'Reached boat destination');
      return true;
    }

    // Check for progress (moved at least 1 block in last 8 seconds)
    if (distToTarget < lastDistance - 1) {
      lastProgressTime = Date.now();
      lastDistance = distToTarget;
    } else if (Date.now() - lastProgressTime > 8000) {
      stopBoat(bot);
      log?.debug({
        currentPos: currentPos.toString(),
        distToTarget: distToTarget.toFixed(1),
        elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
      }, 'Boat stuck, no progress');
      return false;
    }

    // Calculate direction to target
    const dx = destination.x - currentPos.x;
    const dz = destination.z - currentPos.z;
    const targetYaw = Math.atan2(-dx, dz);

    // Get current yaw (bot.entity.yaw is in radians)
    const currentYaw = bot.entity.yaw;
    let yawDiff = targetYaw - currentYaw;

    // Normalize to -PI to PI
    while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

    // Use moveVehicle for boat control
    // left: -1 (right), 0 (straight), 1 (left)
    // forward: -1 (backward), 0 (stop), 1 (forward)
    let leftValue = 0;
    const turnThreshold = 0.3; // ~17 degrees

    if (yawDiff > turnThreshold) {
      leftValue = 1; // Turn left
    } else if (yawDiff < -turnThreshold) {
      leftValue = -1; // Turn right
    }

    // Always move forward
    bot.moveVehicle(leftValue, 1);

    await sleep(100);
  }

  stopBoat(bot);
  log?.debug('Boat navigation timed out');
  return false;
}

/**
 * Stops all boat movement controls.
 */
export function stopBoat(bot: Bot): void {
  // Stop the vehicle
  bot.moveVehicle(0, 0);
  // Also clear control states just in case
  bot.setControlState('forward', false);
  bot.setControlState('left', false);
  bot.setControlState('right', false);
}

/**
 * Dismounts from the current vehicle (boat).
 */
export async function dismountBoat(bot: Bot): Promise<void> {
  const botWithVehicle = bot as Bot & { vehicle?: Entity };
  if (botWithVehicle.vehicle) {
    await bot.dismount();
    await sleep(300);
  }
}
