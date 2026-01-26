#!/usr/bin/env bun
/**
 * Raw TCP Proxy with Packet Logging
 *
 * Forwards bytes transparently while decoding and logging ALL packets.
 * Uses minecraft-data for packet ID mappings (no hardcoded values).
 *
 * Usage:
 *   bun tools/packet-proxy.ts [proxyPort] [serverPort]
 *
 * Environment variables:
 *   MC_VERSION  - Minecraft version (default: 1.21.4)
 *   CONSOLE_FILTER - Comma-separated packet names to show in console (default: all)
 *                    Example: CONSOLE_FILTER=player_input,vehicle_move,steer_boat
 *   QUIET       - Set to 1 to suppress console output (still logs to file)
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as minecraftDataModule from 'minecraft-data';
const minecraftData = (minecraftDataModule as any).default || minecraftDataModule;

const PROXY_PORT = parseInt(process.argv[2] || '25567');
const SERVER_HOST = 'localhost';
const SERVER_PORT = parseInt(process.argv[3] || '25566');
const MC_VERSION = process.env.MC_VERSION || '1.21.6';

// Load packet mappings from minecraft-data
const mcData = minecraftData(MC_VERSION);
if (!mcData.protocol) {
  console.error(`No protocol data found for version ${MC_VERSION}`);
  process.exit(1);
}

// Build packet ID -> name mappings for each state/direction
type PacketMappings = Record<number, string>;
type StateDirection = 'toServer' | 'toClient';
type ProtocolState = 'handshaking' | 'status' | 'login' | 'configuration' | 'play';

function extractMappings(state: ProtocolState, direction: StateDirection): PacketMappings {
  const stateData = mcData.protocol[state];
  if (!stateData || !stateData[direction]) return {};

  const types = stateData[direction].types;
  const packetDef = types?.['packet'];
  if (!packetDef || !Array.isArray(packetDef)) return {};

  // Structure: ["container", [{name: "name", type: ["mapper", {mappings: {...}}]}, ...]]
  const container = packetDef[1];
  if (!Array.isArray(container)) return {};

  const nameField = container.find((f: any) => f.name === 'name');
  if (!nameField?.type?.[1]?.mappings) return {};

  const mappings: PacketMappings = {};
  for (const [hexId, name] of Object.entries(nameField.type[1].mappings)) {
    mappings[parseInt(hexId, 16)] = name as string;
  }
  return mappings;
}

// Pre-compute mappings for play state (most common)
const serverboundPlayPackets = extractMappings('play', 'toServer');
const clientboundPlayPackets = extractMappings('play', 'toClient');

// Console filter - which packets to show in console (empty = all)
const CONSOLE_FILTER = process.env.CONSOLE_FILTER
  ? new Set(process.env.CONSOLE_FILTER.split(',').map(s => s.trim()))
  : null;
const QUIET = process.env.QUIET === '1';

// Create log directory
const logDir = path.join(__dirname, 'packet-logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logDir, `packets-${sessionId}.jsonl`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const filterDisplay = CONSOLE_FILTER
  ? `[${Array.from(CONSOLE_FILTER).join(', ')}]`
  : 'all packets';

console.log(`
╔════════════════════════════════════════════════════════════╗
║              MINECRAFT PACKET PROXY                        ║
╠════════════════════════════════════════════════════════════╣
║  Proxy:    localhost:${PROXY_PORT.toString().padEnd(38)}║
║  Server:   ${SERVER_HOST}:${SERVER_PORT.toString().padEnd(40)}║
║  Version:  ${MC_VERSION.padEnd(48)}║
║  Log:      ${path.basename(logFile).padEnd(47)}║
║  Console:  ${filterDisplay.slice(0, 47).padEnd(47)}║
╚════════════════════════════════════════════════════════════╝

Packet mappings loaded: ${Object.keys(serverboundPlayPackets).length} serverbound, ${Object.keys(clientboundPlayPackets).length} clientbound
`);

function readVarInt(buffer: Buffer, offset: number): { value: number; bytesRead: number } | null {
  let value = 0;
  let bytesRead = 0;
  let currentByte;

  do {
    if (offset + bytesRead >= buffer.length) return null;
    currentByte = buffer[offset + bytesRead]!;
    value |= (currentByte & 0x7f) << (7 * bytesRead);
    bytesRead++;
    if (bytesRead > 5) return null;
  } while ((currentByte & 0x80) !== 0);

  return { value, bytesRead };
}

function log(packet: string, direction: 'C→S' | 'S→C', data: any, showInConsole: boolean = true) {
  const entry = { t: Date.now(), dir: direction, p: packet, data };
  logStream.write(JSON.stringify(entry) + '\n');

  if (QUIET) return;

  // Check console filter
  if (CONSOLE_FILTER && !CONSOLE_FILTER.has(packet)) return;
  if (!showInConsole) return;

  const arrow = direction === 'C→S' ? '\x1b[33m>>>\x1b[0m' : '\x1b[36m<<<\x1b[0m';
  console.log(`${arrow} ${packet.padEnd(30)} ${JSON.stringify(data)}`);
}

// Detailed decoders for specific packets (optional enrichment)
const packetDecoders: Record<string, (data: Buffer) => any> = {
  player_input: (data) => {
    const flags = data[0] || 0;
    const inputs: string[] = [];
    if (flags & 0x01) inputs.push('FWD');
    if (flags & 0x02) inputs.push('BACK');
    if (flags & 0x04) inputs.push('LEFT');
    if (flags & 0x08) inputs.push('RIGHT');
    if (flags & 0x10) inputs.push('JUMP');
    if (flags & 0x20) inputs.push('SNEAK');
    if (flags & 0x40) inputs.push('SPRINT');
    return { flags: `0x${flags.toString(16)}`, inputs: inputs.join('+') || 'none' };
  },

  steer_boat: (data) => {
    return { leftPaddle: data[0] !== 0, rightPaddle: data[1] !== 0 };
  },

  vehicle_move: (data) => {
    if (data.length >= 32) {
      return {
        pos: `(${data.readDoubleBE(0).toFixed(2)}, ${data.readDoubleBE(8).toFixed(2)}, ${data.readDoubleBE(16).toFixed(2)})`,
        yaw: data.readFloatBE(24).toFixed(1),
        pitch: data.readFloatBE(28).toFixed(1)
      };
    }
    return { size: data.length };
  },

  position: (data) => {
    if (data.length >= 24) {
      return {
        pos: `(${data.readDoubleBE(0).toFixed(2)}, ${data.readDoubleBE(8).toFixed(2)}, ${data.readDoubleBE(16).toFixed(2)})`,
      };
    }
    return { size: data.length };
  },

  position_look: (data) => {
    if (data.length >= 32) {
      return {
        pos: `(${data.readDoubleBE(0).toFixed(2)}, ${data.readDoubleBE(8).toFixed(2)}, ${data.readDoubleBE(16).toFixed(2)})`,
        yaw: data.readFloatBE(24).toFixed(1),
        pitch: data.readFloatBE(28).toFixed(1)
      };
    }
    return { size: data.length };
  },

  use_entity: (data) => {
    const targetResult = readVarInt(data, 0);
    if (targetResult) {
      const typeResult = readVarInt(data, targetResult.bytesRead);
      if (typeResult) {
        const types = ['INTERACT', 'ATTACK', 'INTERACT_AT'];
        return { target: targetResult.value, type: types[typeResult.value] || typeResult.value };
      }
    }
    return { size: data.length };
  },

  entity_action: (data) => {
    const entityResult = readVarInt(data, 0);
    if (entityResult) {
      const actionResult = readVarInt(data, entityResult.bytesRead);
      if (actionResult) {
        const actionNames = ['START_SNEAK', 'STOP_SNEAK', 'LEAVE_BED', 'START_SPRINT', 'STOP_SPRINT',
                             'START_HORSE_JUMP', 'STOP_HORSE_JUMP', 'OPEN_VEHICLE_INV', 'START_ELYTRA'];
        return {
          entityId: entityResult.value,
          action: actionNames[actionResult.value] || `UNKNOWN_${actionResult.value}`
        };
      }
    }
    return { size: data.length };
  },

  keep_alive: (data) => {
    if (data.length >= 8) {
      return { id: data.readBigInt64BE(0).toString() };
    }
    return { size: data.length };
  },
};

class PacketParser {
  private buffer: Buffer = Buffer.alloc(0);
  private compressionEnabled: boolean = false;
  private packetCount: number = 0;
  private direction: 'C→S' | 'S→C';
  private packetMappings: PacketMappings;

  constructor(direction: 'C→S' | 'S→C') {
    this.direction = direction;
    this.packetMappings = direction === 'C→S' ? serverboundPlayPackets : clientboundPlayPackets;
  }

  enableCompression() {
    this.compressionEnabled = true;
    console.log(`[*] Compression enabled for ${this.direction} parsing`);
  }

  addData(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.parsePackets();
  }

  private parsePackets() {
    while (this.buffer.length > 0) {
      // Read packet length
      const lengthResult = readVarInt(this.buffer, 0);
      if (!lengthResult) break;

      const packetLength = lengthResult.value;
      const headerSize = lengthResult.bytesRead;

      if (this.buffer.length < headerSize + packetLength) break;

      // Extract raw packet
      const rawPacket = this.buffer.slice(headerSize, headerSize + packetLength);
      this.buffer = this.buffer.slice(headerSize + packetLength);

      // Decompress if needed
      let packetContent: Buffer;

      if (this.compressionEnabled) {
        const dataLengthResult = readVarInt(rawPacket, 0);
        if (!dataLengthResult) continue;

        const uncompressedLength = dataLengthResult.value;
        const compressedData = rawPacket.slice(dataLengthResult.bytesRead);

        if (uncompressedLength === 0) {
          packetContent = compressedData;
        } else {
          try {
            packetContent = zlib.inflateSync(compressedData);
          } catch {
            continue;
          }
        }
      } else {
        packetContent = rawPacket;
      }

      // Read packet ID
      const idResult = readVarInt(packetContent, 0);
      if (!idResult) continue;

      const packetId = idResult.value;
      const dataStart = idResult.bytesRead;
      const packetData = packetContent.slice(dataStart);

      this.packetCount++;

      // Get packet name from mappings
      const packetName = this.packetMappings[packetId] || `unknown_0x${packetId.toString(16).padStart(2, '0')}`;

      // Try to decode with detailed decoder, otherwise just log size
      const decoder = packetDecoders[packetName];
      let decodedData: any;
      try {
        decodedData = decoder ? decoder(packetData) : { size: packetData.length };
      } catch {
        decodedData = { size: packetData.length, error: 'decode_failed' };
      }

      log(packetName, this.direction, decodedData);
    }
  }
}

const server = net.createServer((clientSocket) => {
  console.log(`\n[+] Client connected`);

  const serverSocket = net.createConnection({
    host: SERVER_HOST,
    port: SERVER_PORT,
  });

  const clientParser = new PacketParser('C→S');
  const serverParser = new PacketParser('S→C');

  // Enable compression after delay (server sends set_compression during login)
  setTimeout(() => {
    clientParser.enableCompression();
    serverParser.enableCompression();
  }, 2000);

  serverSocket.on('connect', () => {
    console.log(`[+] Connected to server`);
  });

  // Forward and parse client -> server
  clientSocket.on('data', (data: Buffer) => {
    clientParser.addData(data);
    serverSocket.write(data);
  });

  // Forward and parse server -> client
  serverSocket.on('data', (data: Buffer) => {
    serverParser.addData(data);
    clientSocket.write(data);
  });

  clientSocket.on('close', () => {
    console.log(`[-] Client disconnected`);
    serverSocket.destroy();
  });

  serverSocket.on('close', () => {
    console.log(`[-] Server disconnected`);
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    console.error(`[!] Client error: ${err.message}`);
    serverSocket.destroy();
  });

  serverSocket.on('error', (err) => {
    console.error(`[!] Server error: ${err.message}`);
    clientSocket.destroy();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`Proxy listening on port ${PROXY_PORT}`);
  console.log(`Connect Minecraft to localhost:${PROXY_PORT}`);
  console.log(`\nAll packets logged to file. Console shows: ${CONSOLE_FILTER ? Array.from(CONSOLE_FILTER).join(', ') : 'all packets'}`);
  console.log(`Tip: Use CONSOLE_FILTER=player_input,vehicle_move to filter console output\n`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  logStream.end();
  server.close();
  process.exit(0);
});
