#!/usr/bin/env bun
/**
 * Packet Decoder
 *
 * Decodes hex packet logs using minecraft-protocol's actual deserializer.
 *
 * Usage:
 *   bun tools/decode-packets.ts [logfile]
 *   bun tools/decode-packets.ts --latest
 */

import * as fs from 'fs';
import * as path from 'path';
import mcData from 'minecraft-data';
import { createDeserializer, createSerializer, states } from 'minecraft-protocol';

const logDir = path.join(__dirname, 'packet-logs');
const MC_VERSION = '1.21.4';
const data = mcData(MC_VERSION);

// Create deserializers for play state
const clientboundDeserializer = createDeserializer({
  state: states.PLAY,
  isServer: false, // We're deserializing packets FROM the server (clientbound)
  version: MC_VERSION,
});

const serverboundDeserializer = createDeserializer({
  state: states.PLAY,
  isServer: true, // We're deserializing packets FROM the client (serverbound)
  version: MC_VERSION,
});

// Packets we care about for boat debugging
const INTERESTING_PACKETS = new Set([
  'player_input',
  'vehicle_move',
  'steer_boat',
  'use_entity',
  'position',
  'position_look',
  'look',
  'entity_action',
  'set_passengers',
  'spawn_entity',
  'attach_entity',
]);

interface LogEntry {
  timestamp: number;
  direction: 'C->S' | 'S->C';
  hex: string;
}

function parseLogFile(filePath: string): LogEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: LogEntry[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(' ');
    if (parts.length >= 3) {
      entries.push({
        timestamp: parseInt(parts[0]),
        direction: parts[1] as 'C->S' | 'S->C',
        hex: parts.slice(2).join(''),
      });
    }
  }

  return entries;
}

function readVarInt(buffer: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;
  let currentByte;

  do {
    if (offset + bytesRead >= buffer.length) {
      return { value: -1, bytesRead: 0 };
    }
    currentByte = buffer[offset + bytesRead];
    value |= (currentByte & 0x7f) << (7 * bytesRead);
    bytesRead++;
    if (bytesRead > 5) {
      return { value: -1, bytesRead: 0 };
    }
  } while ((currentByte & 0x80) !== 0);

  return { value, bytesRead };
}

interface DecodedPacket {
  name: string;
  data: any;
  raw: string;
}

function decodePackets(hex: string, direction: 'C->S' | 'S->C'): DecodedPacket[] {
  const buffer = Buffer.from(hex, 'hex');
  const results: DecodedPacket[] = [];
  let offset = 0;

  const deserializer = direction === 'C->S' ? serverboundDeserializer : clientboundDeserializer;

  while (offset < buffer.length) {
    // Read packet length (varint)
    const lengthResult = readVarInt(buffer, offset);
    if (lengthResult.value <= 0 || lengthResult.value > buffer.length - offset) break;

    const packetStart = offset;
    offset += lengthResult.bytesRead;
    const packetLength = lengthResult.value;

    if (offset + packetLength > buffer.length) break;

    // Extract the packet data (length + packet content)
    const packetBuffer = buffer.slice(packetStart, offset + packetLength);

    try {
      // Use minecraft-protocol's deserializer
      const parsed = deserializer.parsePacketBuffer(packetBuffer);
      if (parsed && parsed.data) {
        results.push({
          name: parsed.data.name,
          data: parsed.data.params,
          raw: packetBuffer.toString('hex'),
        });
      }
    } catch (e: any) {
      // If parsing fails, try to at least get the packet ID
      const idResult = readVarInt(buffer, offset);
      results.push({
        name: `unknown_0x${idResult.value.toString(16)}`,
        data: { error: e.message },
        raw: packetBuffer.toString('hex').substring(0, 40),
      });
    }

    offset = packetStart + lengthResult.bytesRead + packetLength;
  }

  return results;
}

function findLatestLog(): string {
  const files = fs.readdirSync(logDir).filter((f) => f.startsWith('raw-') && f.endsWith('.log'));
  if (files.length === 0) throw new Error('No raw log files found in ' + logDir);
  files.sort().reverse();
  return path.join(logDir, files[0]);
}

function formatData(data: any): string {
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'object') {
    // Special handling for common packet data
    if ('inputs' in data) {
      // player_input
      const inputs = data.inputs;
      const flags: string[] = [];
      if (inputs.forward) flags.push('forward');
      if (inputs.backward) flags.push('backward');
      if (inputs.left) flags.push('left');
      if (inputs.right) flags.push('right');
      if (inputs.jump) flags.push('jump');
      if (inputs.shift) flags.push('shift');
      if (inputs.sprint) flags.push('sprint');
      return `inputs=[${flags.join('+')}] raw=0x${(inputs._value || 0).toString(16)}`;
    }
    if ('leftPaddle' in data) {
      // steer_boat
      return `left=${data.leftPaddle} right=${data.rightPaddle}`;
    }
    if ('x' in data && 'y' in data && 'z' in data && 'yaw' in data) {
      // vehicle_move or position
      return `pos=(${data.x?.toFixed(2)}, ${data.y?.toFixed(2)}, ${data.z?.toFixed(2)}) yaw=${data.yaw?.toFixed(1)} pitch=${data.pitch?.toFixed(1)}`;
    }
    return JSON.stringify(data);
  }
  return String(data);
}

// Main
const args = process.argv.slice(2);
let logFile: string;

try {
  if (args[0] === '--latest' || args.length === 0) {
    logFile = findLatestLog();
  } else {
    logFile = args[0].startsWith('/') ? args[0] : path.join(logDir, args[0]);
  }
} catch (e: any) {
  console.error('Error:', e.message);
  console.log('\nNo log files found. Run the proxy first to capture packets.');
  process.exit(1);
}

console.log(`Decoding: ${path.basename(logFile)}\n`);

const entries = parseLogFile(logFile);
console.log(`Found ${entries.length} data chunks\n`);

// Decode and display
console.log('=== DECODED PACKETS ===\n');

let lastTime = entries[0]?.timestamp || 0;
const packetCounts: Record<string, number> = {};

for (const entry of entries) {
  const decoded = decodePackets(entry.hex, entry.direction);

  for (const packet of decoded) {
    packetCounts[packet.name] = (packetCounts[packet.name] || 0) + 1;

    // Only show interesting packets in detail
    if (INTERESTING_PACKETS.has(packet.name)) {
      const delta = entry.timestamp - lastTime;
      lastTime = entry.timestamp;
      const arrow = entry.direction === 'C->S' ? '\x1b[33m>>>\x1b[0m' : '\x1b[36m<<<\x1b[0m';
      console.log(`+${delta.toString().padStart(5)}ms ${arrow} ${packet.name.padEnd(20)} ${formatData(packet.data)}`);
    }
  }
}

// Summary
console.log('\n=== PACKET SUMMARY ===\n');
const sorted = Object.entries(packetCounts).sort((a, b) => b[1] - a[1]);
for (const [name, count] of sorted.slice(0, 30)) {
  const marker = INTERESTING_PACKETS.has(name) ? '*' : ' ';
  console.log(`${marker} ${name.padEnd(30)} ${count}`);
}
console.log('\n* = boat-related packets');
