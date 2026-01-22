#!/usr/bin/env bun
/**
 * Raw TCP Proxy with Manual Packet Decoding
 *
 * Forwards bytes transparently while manually decoding boat packets.
 *
 * Usage:
 *   bun tools/packet-proxy.ts [proxyPort] [serverPort]
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const PROXY_PORT = parseInt(process.argv[2] || '25567');
const SERVER_HOST = 'localhost';
const SERVER_PORT = parseInt(process.argv[3] || '25566');

// Packet IDs for 1.21.4 (serverbound play)
const PACKET_IDS = {
  PLAYER_INPUT: 0x29,
  STEER_BOAT: 0x21,
  VEHICLE_MOVE: 0x20,
  USE_ENTITY: 0x18,
  POSITION: 0x1c,
  POSITION_LOOK: 0x1d,
};

// Create log directory
const logDir = path.join(__dirname, 'packet-logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logDir, `packets-${sessionId}.jsonl`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

console.log(`
╔════════════════════════════════════════════════════════════╗
║           RAW TCP PROXY - BOAT PACKET LOGGER                ║
╠════════════════════════════════════════════════════════════╣
║  Proxy:    localhost:${PROXY_PORT.toString().padEnd(41)}║
║  Server:   ${SERVER_HOST}:${SERVER_PORT.toString().padEnd(43)}║
║  Log:      ${path.basename(logFile).padEnd(47)}║
╚════════════════════════════════════════════════════════════╝
`);

function readVarInt(buffer: Buffer, offset: number): { value: number; bytesRead: number } | null {
  let value = 0;
  let bytesRead = 0;
  let currentByte;

  do {
    if (offset + bytesRead >= buffer.length) return null;
    currentByte = buffer[offset + bytesRead];
    value |= (currentByte & 0x7f) << (7 * bytesRead);
    bytesRead++;
    if (bytesRead > 5) return null;
  } while ((currentByte & 0x80) !== 0);

  return { value, bytesRead };
}

function log(packet: string, data: any) {
  const entry = { t: Date.now(), p: packet, data };
  logStream.write(JSON.stringify(entry) + '\n');
  console.log(`\x1b[33m>>>\x1b[0m ${packet.padEnd(15)} ${JSON.stringify(data)}`);
}

class PacketParser {
  private buffer: Buffer = Buffer.alloc(0);
  private compressionEnabled: boolean = false;
  private packetCount: number = 0;

  enableCompression() {
    this.compressionEnabled = true;
    console.log('[*] Compression enabled for parsing');
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
      let contentOffset = 0;

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

      // Decode specific packets
      this.decodePacket(packetId, packetData);
    }
  }

  private decodePacket(id: number, data: Buffer) {
    try {
      switch (id) {
        case PACKET_IDS.PLAYER_INPUT: {
          // player_input: single byte bitflags
          const flags = data[0] || 0;
          const inputs: string[] = [];
          if (flags & 0x01) inputs.push('FWD');
          if (flags & 0x02) inputs.push('BACK');
          if (flags & 0x04) inputs.push('LEFT');
          if (flags & 0x08) inputs.push('RIGHT');
          if (flags & 0x10) inputs.push('JUMP');
          if (flags & 0x20) inputs.push('SNEAK');
          if (flags & 0x40) inputs.push('SPRINT');
          log('player_input', { flags: `0x${flags.toString(16)}`, inputs: inputs.join('+') || 'none' });
          break;
        }

        case PACKET_IDS.STEER_BOAT: {
          // steer_boat: two booleans
          const leftPaddle = data[0] !== 0;
          const rightPaddle = data[1] !== 0;
          log('steer_boat', { leftPaddle, rightPaddle });
          break;
        }

        case PACKET_IDS.VEHICLE_MOVE: {
          // vehicle_move: x,y,z (f64), yaw,pitch (f32)
          if (data.length >= 32) {
            const x = data.readDoubleBE(0);
            const y = data.readDoubleBE(8);
            const z = data.readDoubleBE(16);
            const yaw = data.readFloatBE(24);
            const pitch = data.readFloatBE(28);
            log('vehicle_move', {
              pos: `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
              yaw: yaw.toFixed(1),
              pitch: pitch.toFixed(1)
            });
          }
          break;
        }

        case PACKET_IDS.USE_ENTITY: {
          // use_entity: target (varint), type (varint), ...
          const targetResult = readVarInt(data, 0);
          if (targetResult) {
            const typeResult = readVarInt(data, targetResult.bytesRead);
            if (typeResult) {
              log('use_entity', { target: targetResult.value, type: typeResult.value });
            }
          }
          break;
        }
      }
    } catch (e) {
      // Ignore decode errors
    }
  }
}

const server = net.createServer((clientSocket) => {
  console.log(`\n[+] Client connected`);

  const serverSocket = net.createConnection({
    host: SERVER_HOST,
    port: SERVER_PORT,
  });

  const parser = new PacketParser();

  // Enable compression after delay (server sends set_compression during login)
  setTimeout(() => {
    parser.enableCompression();
  }, 2000);

  serverSocket.on('connect', () => {
    console.log(`[+] Connected to server`);
  });

  // Forward and parse client -> server
  clientSocket.on('data', (data: Buffer) => {
    parser.addData(data);
    serverSocket.write(data);
  });

  // Forward server -> client (no parsing needed)
  serverSocket.on('data', (data: Buffer) => {
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
  console.log(`\nWaiting for boat packets (player_input, steer_boat, vehicle_move)...\n`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  logStream.end();
  server.close();
  process.exit(0);
});
