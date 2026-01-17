import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { Vec3 } from 'vec3';
import type { Logger } from './logger';

export interface ResourceRequest {
    id: string;
    from: string;        // Bot name requesting
    item: string;        // e.g., 'stick', 'oak_planks'
    quantity: number;
    timestamp: number;
    fulfilled: boolean;
}

export interface BotState {
    role: string;
    lastSeen: number;
    position: { x: number; y: number; z: number };
    provides: string[];  // Items this bot can produce
    needs: string[];     // Items this bot currently needs
}

export interface VillageState {
    villageCenter: { x: number; y: number; z: number } | null;
    sharedChest: { x: number; y: number; z: number } | null;
    bots: Record<string, BotState>;
    requests: ResourceRequest[];
}

function createEmptyState(): VillageState {
    return {
        villageCenter: null,
        sharedChest: null,
        bots: {},
        requests: []
    };
}

export class VillageManager {
    private filePath: string;
    private writeLock: Promise<void> = Promise.resolve();
    private log: Logger | null = null;

    constructor(filePath: string = './shared/village.json') {
        this.filePath = resolve(filePath);
    }

    /** Set a logger for this manager (useful for shared singleton) */
    setLogger(logger: Logger): void {
        this.log = logger;
    }

    private async ensureDir(): Promise<void> {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    async read(): Promise<VillageState> {
        try {
            await this.ensureDir();
            if (!existsSync(this.filePath)) {
                return createEmptyState();
            }
            const data = await readFile(this.filePath, 'utf-8');
            if (!data || data.trim() === '') {
                return createEmptyState();
            }
            return JSON.parse(data) as VillageState;
        } catch (error) {
            // If file is corrupted, reset it
            this.log?.warn({ err: error }, 'Failed to read state, resetting');
            try {
                await this.write(createEmptyState());
            } catch {
                // Ignore
            }
            return createEmptyState();
        }
    }

    async write(state: VillageState): Promise<void> {
        // Queue writes to prevent race conditions
        this.writeLock = this.writeLock.then(async () => {
            await this.ensureDir();
            const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
            try {
                const content = JSON.stringify(state, null, 2);
                await writeFile(tempPath, content, 'utf-8');
                await rename(tempPath, this.filePath);
            } catch (error) {
                // Clean up temp file on error
                try {
                    await unlink(tempPath);
                } catch {
                    // Ignore
                }
                this.log?.error({ err: error }, 'Failed to write state');
            }
        });
        await this.writeLock;
    }

    async updateBot(name: string, data: Partial<BotState>): Promise<void> {
        const state = await this.read();
        const existing = state.bots[name] || {
            role: 'unknown',
            lastSeen: Date.now(),
            position: { x: 0, y: 0, z: 0 },
            provides: [],
            needs: []
        };
        state.bots[name] = {
            ...existing,
            ...data,
            lastSeen: Date.now()
        };
        await this.write(state);
    }

    async setVillageCenter(pos: Vec3): Promise<boolean> {
        const state = await this.read();
        // Return false if already set (first bot wins)
        if (state.villageCenter !== null) {
            return false;
        }
        state.villageCenter = { x: pos.x, y: pos.y, z: pos.z };
        await this.write(state);
        this.log?.info({ pos: pos.toString() }, 'Village center established');
        return true;
    }

    async getVillageCenter(): Promise<Vec3 | null> {
        const state = await this.read();
        if (!state.villageCenter) return null;
        return new Vec3(
            state.villageCenter.x,
            state.villageCenter.y,
            state.villageCenter.z
        );
    }

    async setSharedChest(pos: Vec3): Promise<void> {
        const state = await this.read();
        state.sharedChest = { x: pos.x, y: pos.y, z: pos.z };
        await this.write(state);
        this.log?.info({ pos: pos.toString() }, 'Shared chest registered');
    }

    async getSharedChest(): Promise<Vec3 | null> {
        const state = await this.read();
        if (!state.sharedChest) return null;
        return new Vec3(
            state.sharedChest.x,
            state.sharedChest.y,
            state.sharedChest.z
        );
    }

    // Request system
    async requestResource(from: string, item: string, quantity: number): Promise<string> {
        const state = await this.read();
        const id = `${from}-${item}-${Date.now()}`;
        state.requests.push({
            id,
            from,
            item,
            quantity,
            timestamp: Date.now(),
            fulfilled: false
        });
        await this.write(state);
        this.log?.info({ from, item, quantity }, 'Resource request created');
        return id;
    }

    async getPendingRequests(forRole: string): Promise<ResourceRequest[]> {
        const state = await this.read();
        // Map role to items they can fulfill
        const roleCapabilities: Record<string, string[]> = {
            'lumberjack': ['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'birch_planks', 'spruce_planks', 'stick', 'crafting_table'],
            'farming': ['wheat', 'wheat_seeds', 'carrot', 'potato', 'beetroot']
        };

        const canProvide = roleCapabilities[forRole] || [];
        return state.requests.filter(r =>
            !r.fulfilled && canProvide.some(item => r.item.includes(item) || item.includes(r.item))
        );
    }

    async fulfillRequest(requestId: string): Promise<void> {
        const state = await this.read();
        const request = state.requests.find(r => r.id === requestId);
        if (request) {
            request.fulfilled = true;
            await this.write(state);
            this.log?.info({ from: request.from, item: request.item, quantity: request.quantity }, 'Request fulfilled');
        }
    }

    async cancelStaleRequests(maxAge: number = 5 * 60 * 1000): Promise<void> {
        const state = await this.read();
        const now = Date.now();
        const before = state.requests.length;
        state.requests = state.requests.filter(r =>
            r.fulfilled || (now - r.timestamp < maxAge)
        );
        const removed = before - state.requests.length;
        if (removed > 0) {
            await this.write(state);
            this.log?.debug({ removed }, 'Cleaned up stale requests');
        }
    }

    async hasUnfulfilledRequestFor(botName: string, item: string): Promise<boolean> {
        const state = await this.read();
        return state.requests.some(r =>
            r.from === botName &&
            r.item === item &&
            !r.fulfilled
        );
    }

    async cleanupOldBots(maxAge: number = 60 * 1000): Promise<void> {
        const state = await this.read();
        const now = Date.now();
        const before = Object.keys(state.bots).length;
        for (const [name, bot] of Object.entries(state.bots)) {
            if (now - bot.lastSeen > maxAge) {
                delete state.bots[name];
            }
        }
        const removed = before - Object.keys(state.bots).length;
        if (removed > 0) {
            await this.write(state);
            this.log?.debug({ removed }, 'Cleaned up stale bot entries');
        }
    }
}

// Singleton instance for shared access
export const villageManager = new VillageManager();
