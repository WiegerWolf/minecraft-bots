/**
 * Boat placement and navigation utilities.
 *
 * PLACEMENT: Works with MC 1.21+ via patched mineflayer (patches/mineflayer+4.33.0.patch).
 * The use_item packet format changed to require rotation fields.
 * @see https://github.com/PrismarineJS/mineflayer/issues/3742
 *
 * NAVIGATION: Limited functionality on Paper/Spigot servers.
 * Paper's movement validation rejects client-side vehicle_move packets,
 * preventing mineflayer from controlling boat movement. Works on vanilla servers.
 * On Paper servers, the bot will need to swim instead of using boats.
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
 * Prefers water blocks that are surrounded by more water (not at shore edge).
 * Returns water block with air above it.
 */
export function findNearbyWaterBlock(bot: Bot, searchRadius: number = 8): any | null {
  const pos = bot.entity.position;
  let bestBlock: any = null;
  let bestScore = -Infinity;

  // Helper to check if a block is water
  const isWater = (p: Vec3) => {
    const b = bot.blockAt(p);
    return b && (b.name === 'water' || b.name === 'flowing_water');
  };

  // Helper to count water neighbors (more = better for boat placement)
  const countWaterNeighbors = (p: Vec3): number => {
    let count = 0;
    // Check all 4 cardinal directions
    if (isWater(p.offset(1, 0, 0))) count++;
    if (isWater(p.offset(-1, 0, 0))) count++;
    if (isWater(p.offset(0, 0, 1))) count++;
    if (isWater(p.offset(0, 0, -1))) count++;
    return count;
  };

  // Search for water blocks
  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
      for (let dy = -2; dy <= 1; dy++) {
        const checkPos = pos.offset(dx, dy, dz);
        const block = bot.blockAt(checkPos);

        if (block && (block.name === 'water' || block.name === 'flowing_water')) {
          // Verify there's air above for the boat
          const above = bot.blockAt(checkPos.offset(0, 1, 0));
          if (above && above.name === 'air') {
            const dist = pos.distanceTo(checkPos);
            const waterNeighbors = countWaterNeighbors(checkPos);

            // Score: prefer more water neighbors, but not too far away
            // Water surrounded by 4 water blocks is ideal (score +40)
            // Penalize distance slightly (-1 per block)
            const score = waterNeighbors * 10 - dist;

            // Must have at least 2 water neighbors (not at corner of shore)
            if (waterNeighbors >= 2 && score > bestScore) {
              bestScore = score;
              bestBlock = block;
            }
          }
        }
      }
    }
  }

  // Fallback: if no good water found, just return nearest water
  if (!bestBlock) {
    for (let dist = 1; dist <= searchRadius; dist++) {
      for (let dx = -dist; dx <= dist; dx++) {
        for (let dz = -dist; dz <= dist; dz++) {
          for (let dy = -2; dy <= 1; dy++) {
            const checkPos = pos.offset(dx, dy, dz);
            const block = bot.blockAt(checkPos);
            if (block && (block.name === 'water' || block.name === 'flowing_water')) {
              const above = bot.blockAt(checkPos.offset(0, 1, 0));
              if (above && above.name === 'air') {
                return block;
              }
            }
          }
        }
      }
    }
  }

  return bestBlock;
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
 * Uses mineflayer's placeEntity with a spawn event listener as backup.
 * Simplified to avoid placing duplicate boats.
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

  // If there's an existing boat nearby, break it first to avoid confusion
  // (it might be from a previous failed attempt or cleanup failure)
  let existingBoat = findNearbyBoat(bot, 8);
  if (existingBoat) {
    log?.debug({ boatId: existingBoat.id }, 'Found existing boat nearby, breaking it first');
    // Keep attacking until the boat is gone (boats have 4 health, need multiple hits)
    for (let i = 0; i < 10 && existingBoat; i++) {
      try {
        await bot.attack(existingBoat);
        await sleep(250);
        // Check if boat is still there
        existingBoat = findNearbyBoat(bot, 8);
      } catch {
        break; // Boat probably gone
      }
    }
    if (!findNearbyBoat(bot, 8)) {
      log?.debug('Existing boat destroyed');
    } else {
      log?.warn('Could not destroy existing boat');
    }
  }

  // Equip the boat
  await bot.equip(boatItem, 'hand');
  await sleep(200);

  // Verify boat is equipped
  if (!bot.heldItem || !bot.heldItem.name.includes('boat')) {
    log?.warn({ heldItem: bot.heldItem?.name }, 'Failed to equip boat');
    return null;
  }
  log?.debug({ heldItem: bot.heldItem.name }, 'Boat equipped');

  // Look down at the water surface
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
  // We race between placeEntity returning and the spawn event firing
  // This ensures we return immediately when the boat spawns, not waiting for placeEntity timeout
  const boatSpawnPromise = new Promise<Entity | null>((resolve) => {
    const timeoutId = setTimeout(() => {
      bot.off('entitySpawn', onSpawn);
      resolve(null);
    }, timeout);

    function onSpawn(entity: Entity) {
      if (entity.name?.includes('boat')) {
        clearTimeout(timeoutId);
        bot.off('entitySpawn', onSpawn);
        log?.debug({ boatId: entity.id, entityPos: entity.position?.toString() }, 'Boat spawned via event');
        resolve(entity);
      }
    }

    bot.on('entitySpawn', onSpawn);
  });

  // Start placeEntity but don't await it directly - race with spawn event
  log?.debug('Placing boat with placeEntity...');
  const placeEntityPromise = bot.placeEntity(waterBlock, new Vec3(0, 1, 0))
    .then((entity) => {
      log?.debug({ boatId: entity?.id }, 'placeEntity returned successfully');
      return entity;
    })
    .catch((err: any) => {
      // This often fails on Paper servers even though the boat spawned
      log?.debug({ error: err.message }, 'placeEntity threw error (boat may still have spawned)');
      return null;
    });

  // Race: return as soon as EITHER placeEntity succeeds OR spawn event fires
  // This is critical - we don't want to wait 5 seconds for placeEntity to timeout
  const result = await Promise.race([placeEntityPromise, boatSpawnPromise]);

  if (result) {
    log?.debug({ boatId: result.id }, 'Got boat from race');
    return result;
  }

  // Wait a bit and check for nearby boat (might have spawned but we missed the event)
  await sleep(500);
  const nearbyBoat = findNearbyBoat(bot, 8);
  if (nearbyBoat) {
    log?.debug({ boatId: nearbyBoat.id }, 'Found boat nearby after placement');
    return nearbyBoat;
  }

  log?.warn('Boat placement failed - no boat entity found');
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
 * Result from boat navigation with more details.
 */
export interface BoatNavigationResult {
  success: boolean;          // True if reached destination
  reason: 'reached' | 'land_collision' | 'no_progress' | 'timeout';
  distanceRemaining: number; // Distance to destination when stopped
  lastPos?: Vec3;            // Last known boat position (for dismount)
  lastYawDeg?: number;       // Last known boat yaw in degrees (for dismount)
}

/**
 * Navigates a boat toward a destination using vehicle controls.
 *
 * NOTE: Boat navigation has limited support on Paper/Spigot servers.
 * Paper's movement validation rejects client-side position updates,
 * so the boat may not move. Falls back quickly to allow swimming.
 *
 * @param bot - The bot instance
 * @param destination - Target position
 * @param maxTime - Maximum navigation time in ms (default: 30000)
 * @param log - Optional logger
 * @returns Navigation result with success status and reason
 */
export async function navigateBoatToward(
  bot: Bot,
  destination: Vec3,
  maxTime: number = 30000,
  log?: { debug: Function }
): Promise<BoatNavigationResult> {
  const startTime = Date.now();
  const startPos = bot.entity.position.clone();
  let lastProgressTime = startTime;
  let lastDistance = bot.entity.position.xzDistanceTo(destination);
  let lastLandCheckTime = startTime;

  log?.debug({
    startPos: startPos.toString(),
    destination: destination.toString(),
    initialDist: lastDistance.toFixed(1),
  }, 'Starting boat navigation');

  const botWithVehicle = bot as Bot & { vehicle?: Entity };
  const client = (bot as any)._client;

  // Track local position for physics calculation
  // Real client calculates physics locally and sends position to server
  let localPos = startPos.clone();
  let localYaw = bot.entity.yaw; // radians
  const BOAT_SPEED = 0.2; // blocks per tick when paddling forward (approx)

  let tickCount = 0;
  try {
    while (Date.now() - startTime < maxTime) {
      tickCount++;
      // Use SERVER position for "reached" detection (actual boat location)
      const serverPos = bot.entity.position;
      const serverDistToTarget = serverPos.xzDistanceTo(destination);

      // Use LOCAL position for physics calculation (what we're sending)
      const localDistToTarget = Math.sqrt(
        Math.pow(destination.x - localPos.x, 2) +
        Math.pow(destination.z - localPos.z, 2)
      );

      // Calculate direction to target using local position
      const dx = destination.x - localPos.x;
      const dz = destination.z - localPos.z;
      const targetYaw = Math.atan2(-dx, dz);

      // Track last known good position for dismount
      const lastYawDeg = localYaw * (180 / Math.PI);

      // Check if we're close enough using SERVER position (actual boat location)
      if (serverDistToTarget < 15) {
        log?.debug({
          serverDist: serverDistToTarget.toFixed(1),
          localDist: localDistToTarget.toFixed(1),
          serverPos: `(${serverPos.x.toFixed(1)}, ${serverPos.z.toFixed(1)})`
        }, 'Reached boat destination');
        return { success: true, reason: 'reached', distanceRemaining: serverDistToTarget, lastPos: localPos.clone(), lastYawDeg };
      }

      // Check for land ahead every second (not every tick for performance)
      if (Date.now() - lastLandCheckTime > 1000) {
        lastLandCheckTime = Date.now();
        if (hasLandAhead(bot, targetYaw, 3)) {
          log?.debug({
            distToTarget: serverDistToTarget.toFixed(1),
          }, 'Land detected ahead, stopping boat');
          return { success: false, reason: 'land_collision', distanceRemaining: serverDistToTarget, lastPos: localPos.clone(), lastYawDeg };
        }
      }

      // Progress check: if server position isn't moving, boat physics aren't working
      if (serverDistToTarget < lastDistance - 0.5) {
        lastProgressTime = Date.now();
        lastDistance = serverDistToTarget;
      } else if (Date.now() - lastProgressTime > 10000) {
        // Give 10 seconds for server to catch up before giving up
        log?.debug({
          serverDist: serverDistToTarget.toFixed(1),
          localDist: localDistToTarget.toFixed(1),
          elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
        }, 'Server not updating boat position');
        return { success: false, reason: 'no_progress', distanceRemaining: serverDistToTarget, lastPos: localPos.clone(), lastYawDeg };
      }

      // Smoothly turn toward target (boats don't turn instantly)
      const yawDiff = targetYaw - localYaw;
      // Normalize to -PI to PI
      const normalizedDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
      // Turn rate: about 5 degrees per tick max
      const maxTurn = 0.09; // ~5 degrees in radians
      if (Math.abs(normalizedDiff) > maxTurn) {
        localYaw += Math.sign(normalizedDiff) * maxTurn;
      } else {
        localYaw = targetYaw;
      }

      // Calculate local physics - move forward in the direction we're facing
      // Boat speed is about 0.2 blocks per tick when paddling
      const moveX = -Math.sin(localYaw) * BOAT_SPEED;
      const moveZ = Math.cos(localYaw) * BOAT_SPEED;
      localPos.x += moveX;
      localPos.z += moveZ;

      // Set look direction
      bot.look(localYaw, 0, false).catch(() => {});

      // Send movement packets (based on real client behavior)
      // Real client sends: player_input -> steer_boat -> vehicle_move every tick
      try {
        // player_input for movement control (MC 1.21+)
        client.write('player_input', {
          inputs: { forward: true }
        });

        // steer_boat for paddle animation (both paddles for forward movement)
        client.write('steer_boat', { leftPaddle: true, rightPaddle: true });

        // vehicle_move with our calculated position
        // Server will validate - if too far off, it will rubberband us
        client.write('vehicle_move', {
          x: localPos.x,
          y: localPos.y,
          z: localPos.z,
          yaw: localYaw * (180 / Math.PI), // Convert radians to degrees
          pitch: 0,
        });
      } catch {
        // Ignore packet errors
      }

      // Also use mineflayer's API
      bot.moveVehicle(0, 1);

      await sleep(50); // 20 ticks per second like Minecraft
    }

    log?.debug('Boat navigation timed out');
    const finalDist = bot.entity.position.xzDistanceTo(destination);
    const lastYawDeg = localYaw * (180 / Math.PI);
    return { success: false, reason: 'timeout', distanceRemaining: finalDist, lastPos: localPos.clone(), lastYawDeg };
  } finally {
    // Don't call stopBoat here - let caller handle dismount with correct position
  }
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

  // Send empty flags to stop boat input (MC 1.21+ bitflags format)
  try {
    const client = (bot as any)._client;
    client.write('player_input', { inputs: {} });
    client.write('steer_boat', { leftPaddle: false, rightPaddle: false });
  } catch {
    // Ignore packet errors
  }
}

/**
 * Dismounts from the current vehicle (boat).
 *
 * In MC 1.21.4, dismounting requires sending entity_action with START_SNEAK (action 0)
 * followed by player_input with SHIFT flag. The entity_action packet is what actually
 * triggers the server to dismount the player - player_input alone doesn't work.
 * Mineflayer's bot.dismount() sends JUMP which doesn't work for boats.
 *
 * @param bot - The bot instance
 * @param lastKnownPos - Last known boat position (unused, kept for API compat)
 * @param lastKnownYaw - Last known boat yaw in degrees (unused, kept for API compat)
 * @param log - Optional logger
 */
export async function dismountBoat(
  bot: Bot,
  lastKnownPos?: Vec3,
  lastKnownYaw?: number,
  log?: { debug: Function }
): Promise<void> {
  const botWithVehicle = bot as Bot & { vehicle?: Entity };
  if (botWithVehicle.vehicle) {
    log?.debug({ vehicleId: botWithVehicle.vehicle.id }, 'Dismounting from vehicle');

    const client = (bot as any)._client;
    const vehicle = botWithVehicle.vehicle;

    // Use provided position or try to get from vehicle entity
    const pos = lastKnownPos || vehicle?.position || bot.entity.position;
    const yawDeg = lastKnownYaw ?? 0;

    try {
      // CRITICAL: Send entity_action START_SNEAK first - this triggers the dismount
      // Real client sends entity_action BEFORE player_input, and does NOT continue
      // sending vehicle_move after (the player is already out of the boat)
      const playerEntityId = bot.entity.id;
      client.write('entity_action', {
        entityId: playerEntityId,
        actionId: 0, // START_SNEAK
        jumpBoost: 0,
      });

      // Send player_input with SNEAK flag (same tick as entity_action in real client)
      client.write('player_input', { inputs: { shift: true } });

      // Wait for server to process the dismount
      await sleep(100);

      // Release SHIFT and send STOP_SNEAK
      client.write('player_input', { inputs: {} });
      client.write('entity_action', {
        entityId: playerEntityId,
        actionId: 1, // STOP_SNEAK
        jumpBoost: 0,
      });
    } catch (err) {
      log?.debug({ err }, 'Failed to send dismount packet, trying bot.dismount()');
      await bot.dismount();
    }

    await sleep(300); // Give time for dismount to complete
    log?.debug('Dismount complete');
  } else {
    log?.debug('No vehicle to dismount from');
  }
}

/**
 * Breaks a nearby boat entity to pick it up.
 *
 * @param bot - The bot instance
 * @param maxDistance - Maximum distance to search for boat (default: 5)
 * @param log - Optional logger
 * @returns True if a boat was broken, false otherwise
 */
export async function breakNearbyBoat(
  bot: Bot,
  maxDistance: number = 5,
  log?: { debug: Function }
): Promise<boolean> {
  const boatEntity = findNearbyBoat(bot, maxDistance);
  if (!boatEntity) {
    log?.debug('No boat found nearby to break');
    return false;
  }

  log?.debug({ boatId: boatEntity.id, pos: boatEntity.position.toString() }, 'Breaking boat');

  try {
    // Attack the boat to break it
    await bot.attack(boatEntity);
    await sleep(500);

    // The boat drops as an item - we'll pick it up naturally or via pickup action
    log?.debug('Boat broken');
    return true;
  } catch (err) {
    log?.debug({ err }, 'Failed to break boat');
    return false;
  }
}

/**
 * Dismounts from boat and breaks it to recover the item.
 *
 * @param bot - The bot instance
 * @param lastKnownPos - Last known boat position (from navigation)
 * @param lastKnownYaw - Last known boat yaw in degrees (from navigation)
 * @param log - Optional logger
 */
export async function dismountAndBreakBoat(
  bot: Bot,
  lastKnownPos?: Vec3,
  lastKnownYaw?: number,
  log?: { debug: Function }
): Promise<void> {
  await dismountBoat(bot, lastKnownPos, lastKnownYaw, log);
  await breakNearbyBoat(bot, 5, log);
}

/**
 * Checks if there is solid land directly ahead of the boat.
 * Used to detect when the boat should be abandoned for walking.
 *
 * @param bot - The bot instance
 * @param yaw - The direction to check (in radians)
 * @param distance - How far ahead to check (default: 3)
 * @returns True if there is solid land ahead
 */
export function hasLandAhead(bot: Bot, yaw: number, distance: number = 3): boolean {
  const pos = bot.entity.position;
  // Calculate position ahead in the direction of yaw
  const checkX = pos.x - Math.sin(yaw) * distance;
  const checkZ = pos.z + Math.cos(yaw) * distance;

  // Check at water level and one block above
  for (let dy = 0; dy <= 1; dy++) {
    const block = bot.blockAt(new Vec3(checkX, pos.y + dy, checkZ));
    if (block && !block.transparent && block.name !== 'water' && block.name !== 'air') {
      return true;
    }
  }
  return false;
}
