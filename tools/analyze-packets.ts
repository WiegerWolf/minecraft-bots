#!/usr/bin/env bun
/**
 * Packet Log Analyzer
 *
 * Analyzes packet logs from the proxy to understand boat movement.
 *
 * Usage:
 *   bun tools/analyze-packets.ts [logfile]
 *   bun tools/analyze-packets.ts --compare file1.jsonl file2.jsonl
 *   bun tools/analyze-packets.ts --latest
 */

import * as fs from 'fs';
import * as path from 'path';

const logDir = path.join(__dirname, 'packet-logs');

interface PacketEntry {
  time: number;
  dir: 'C->S' | 'S->C';
  packet: string;
  data: any;
}

function loadLog(filePath: string): PacketEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function findLatestLog(): string {
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) throw new Error('No log files found');
  files.sort().reverse();
  return path.join(logDir, files[0]);
}

function analyzeBoatMovement(entries: PacketEntry[]) {
  console.log('\n=== BOAT MOVEMENT ANALYSIS ===\n');

  // Find player_input packets
  const playerInputs = entries.filter((e) => e.packet === 'player_input');
  console.log(`player_input packets: ${playerInputs.length}`);
  if (playerInputs.length > 0) {
    console.log('Sample player_input data:');
    playerInputs.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}:`, JSON.stringify(p.data));
    });
  }

  // Find vehicle_move packets
  const vehicleMoves = entries.filter((e) => e.packet === 'vehicle_move');
  console.log(`\nvehicle_move packets: ${vehicleMoves.length}`);
  if (vehicleMoves.length > 0) {
    console.log('Sample vehicle_move data:');
    vehicleMoves.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}:`, JSON.stringify(p.data));
    });
  }

  // Find steer_boat packets
  const steerBoats = entries.filter((e) => e.packet === 'steer_boat');
  console.log(`\nsteer_boat packets: ${steerBoats.length}`);
  if (steerBoats.length > 0) {
    console.log('Sample steer_boat data:');
    steerBoats.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}:`, JSON.stringify(p.data));
    });
  }

  // Find steer_vehicle packets
  const steerVehicles = entries.filter((e) => e.packet === 'steer_vehicle');
  console.log(`\nsteer_vehicle packets: ${steerVehicles.length}`);
  if (steerVehicles.length > 0) {
    console.log('Sample steer_vehicle data:');
    steerVehicles.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}:`, JSON.stringify(p.data));
    });
  }

  // Find position packets while in boat
  const positions = entries.filter((e) => e.packet === 'position' || e.packet === 'position_look');
  console.log(`\nposition/position_look packets: ${positions.length}`);

  // Find entity spawn (boat)
  const spawns = entries.filter((e) => e.packet === 'spawn_entity' && e.dir === 'S->C');
  console.log(`\nspawn_entity packets (server->client): ${spawns.length}`);
  spawns.forEach((p) => {
    console.log(`  Entity type: ${p.data.type}, id: ${p.data.entityId}`);
  });

  // Find set_passengers
  const passengers = entries.filter((e) => e.packet === 'set_passengers');
  console.log(`\nset_passengers packets: ${passengers.length}`);
  passengers.forEach((p) => {
    console.log(`  Vehicle: ${p.data.entityId}, passengers: ${JSON.stringify(p.data.passengers)}`);
  });

  // Timeline of interesting events
  console.log('\n=== TIMELINE ===\n');
  const timeline = entries
    .filter((e) => ['player_input', 'vehicle_move', 'steer_boat', 'steer_vehicle', 'set_passengers', 'spawn_entity'].includes(e.packet))
    .slice(0, 50);

  let lastTime = timeline[0]?.time || 0;
  timeline.forEach((e) => {
    const delta = e.time - lastTime;
    lastTime = e.time;
    const arrow = e.dir === 'C->S' ? '>>>' : '<<<';
    console.log(`+${delta.toString().padStart(4)}ms ${arrow} ${e.packet.padEnd(20)} ${JSON.stringify(e.data).substring(0, 80)}`);
  });
}

function compare(file1: string, file2: string) {
  console.log(`\n=== COMPARING ===`);
  console.log(`File 1: ${path.basename(file1)}`);
  console.log(`File 2: ${path.basename(file2)}`);

  const entries1 = loadLog(file1);
  const entries2 = loadLog(file2);

  console.log('\n--- FILE 1 ---');
  analyzeBoatMovement(entries1);

  console.log('\n--- FILE 2 ---');
  analyzeBoatMovement(entries2);
}

// Main
const args = process.argv.slice(2);

if (args[0] === '--compare' && args[1] && args[2]) {
  compare(args[1], args[2]);
} else if (args[0] === '--latest' || args.length === 0) {
  const logFile = findLatestLog();
  console.log(`Analyzing: ${logFile}`);
  const entries = loadLog(logFile);
  analyzeBoatMovement(entries);
} else if (args[0]) {
  const logFile = args[0].startsWith('/') ? args[0] : path.join(logDir, args[0]);
  console.log(`Analyzing: ${logFile}`);
  const entries = loadLog(logFile);
  analyzeBoatMovement(entries);
} else {
  console.log(`
Usage:
  bun tools/analyze-packets.ts [logfile]
  bun tools/analyze-packets.ts --compare file1.jsonl file2.jsonl
  bun tools/analyze-packets.ts --latest
`);
}
