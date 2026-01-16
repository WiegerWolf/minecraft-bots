import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/**
 * Chat-based village communication system.
 * Bots communicate via in-game chat using prefixed messages.
 *
 * Message formats:
 * - [VILLAGE] center <x> <y> <z>           - Announce village center
 * - [CHEST] shared <x> <y> <z>             - Announce shared chest location
 * - [REQUEST] <item> <quantity>            - Request resources
 * - [FULFILL] <item> <quantity> for <bot>  - Announce fulfilled request
 * - [STATUS] <role> at <x> <y> <z>         - Periodic status update
 */

export interface ResourceRequest {
    from: string;
    item: string;
    quantity: number;
    timestamp: number;
}

export interface VillageChatState {
    villageCenter: Vec3 | null;
    sharedChest: Vec3 | null;
    sharedCraftingTable: Vec3 | null;
    pendingRequests: ResourceRequest[];
}

export class VillageChat {
    private state: VillageChatState = {
        villageCenter: null,
        sharedChest: null,
        sharedCraftingTable: null,
        pendingRequests: []
    };

    private bot: Bot;
    private onRequestCallback: ((request: ResourceRequest) => void) | null = null;

    constructor(bot: Bot) {
        this.bot = bot;
        this.setupChatListener();
    }

    private setupChatListener() {
        this.bot.on('chat', (username: string, message: string) => {
            // Ignore own messages
            if (username === this.bot.username) return;

            // Parse village messages
            if (message.startsWith('[VILLAGE] center ')) {
                const match = message.match(/\[VILLAGE\] center (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    if (!this.state.villageCenter) {
                        this.state.villageCenter = pos;
                        console.log(`[VillageChat] Learned village center from ${username}: ${pos}`);
                    }
                }
            }

            // Parse shared chest messages
            if (message.startsWith('[CHEST] shared ')) {
                const match = message.match(/\[CHEST\] shared (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    this.state.sharedChest = pos;
                    console.log(`[VillageChat] Learned shared chest from ${username}: ${pos}`);
                }
            }

            // Parse shared crafting table messages
            if (message.startsWith('[CRAFTING] shared ')) {
                const match = message.match(/\[CRAFTING\] shared (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    this.state.sharedCraftingTable = pos;
                    console.log(`[VillageChat] Learned shared crafting table from ${username}: ${pos}`);
                }
            }

            // Parse resource requests
            if (message.startsWith('[REQUEST] ')) {
                const match = message.match(/\[REQUEST\] (\w+) (\d+)/);
                if (match) {
                    const request: ResourceRequest = {
                        from: username,
                        item: match[1]!,
                        quantity: parseInt(match[2]!),
                        timestamp: Date.now()
                    };
                    // Avoid duplicates
                    const isDupe = this.state.pendingRequests.some(r =>
                        r.from === request.from && r.item === request.item && Date.now() - r.timestamp < 30000
                    );
                    if (!isDupe) {
                        this.state.pendingRequests.push(request);
                        console.log(`[VillageChat] ${username} requested ${request.quantity}x ${request.item}`);
                        if (this.onRequestCallback) {
                            this.onRequestCallback(request);
                        }
                    }
                }
            }

            // Parse fulfillment messages
            if (message.startsWith('[FULFILL] ')) {
                const match = message.match(/\[FULFILL\] (\w+) (\d+) for (\w+)/);
                if (match) {
                    const item = match[1]!;
                    const forBot = match[3]!;
                    // Remove fulfilled request
                    this.state.pendingRequests = this.state.pendingRequests.filter(r =>
                        !(r.from === forBot && r.item === item)
                    );
                    console.log(`[VillageChat] ${username} fulfilled ${item} request for ${forBot}`);
                }
            }
        });
    }

    // Called when another bot makes a request
    onRequest(callback: (request: ResourceRequest) => void) {
        this.onRequestCallback = callback;
    }

    // Announce village center
    announceVillageCenter(pos: Vec3): boolean {
        if (this.state.villageCenter) {
            return false; // Already have one
        }
        this.state.villageCenter = pos;
        const msg = `[VILLAGE] center ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
        return true;
    }

    // Announce shared chest
    announceSharedChest(pos: Vec3) {
        this.state.sharedChest = pos;
        const msg = `[CHEST] shared ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
    }

    // Announce shared crafting table
    announceSharedCraftingTable(pos: Vec3) {
        this.state.sharedCraftingTable = pos;
        const msg = `[CRAFTING] shared ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
    }

    // Request resources from other bots
    requestResource(item: string, quantity: number) {
        // Check if we already have a pending request for this
        const existing = this.state.pendingRequests.find(r =>
            r.from === this.bot.username && r.item === item
        );
        if (existing) {
            return; // Already requested
        }

        const request: ResourceRequest = {
            from: this.bot.username,
            item,
            quantity,
            timestamp: Date.now()
        };
        this.state.pendingRequests.push(request);

        const msg = `[REQUEST] ${item} ${quantity}`;
        this.bot.chat(msg);
    }

    // Announce that we fulfilled a request
    announceFulfillment(item: string, quantity: number, forBot: string) {
        // Remove from our pending list
        this.state.pendingRequests = this.state.pendingRequests.filter(r =>
            !(r.from === forBot && r.item === item)
        );

        const msg = `[FULFILL] ${item} ${quantity} for ${forBot}`;
        this.bot.chat(msg);
    }

    // Check if we have a pending request for an item
    hasPendingRequestFor(item: string): boolean {
        return this.state.pendingRequests.some(r =>
            r.from === this.bot.username && r.item === item
        );
    }

    // Get requests that this bot can fulfill (based on role)
    getRequestsToFulfill(canProvide: string[]): ResourceRequest[] {
        return this.state.pendingRequests.filter(r =>
            r.from !== this.bot.username &&
            canProvide.some(item => r.item.includes(item) || item.includes(r.item))
        );
    }

    // Clean up old requests
    cleanupOldRequests(maxAge: number = 60000) {
        const now = Date.now();
        this.state.pendingRequests = this.state.pendingRequests.filter(r =>
            now - r.timestamp < maxAge
        );
    }

    // Getters
    getVillageCenter(): Vec3 | null {
        return this.state.villageCenter;
    }

    setVillageCenter(pos: Vec3) {
        this.state.villageCenter = pos;
    }

    getSharedChest(): Vec3 | null {
        return this.state.sharedChest;
    }

    setSharedChest(pos: Vec3) {
        this.state.sharedChest = pos;
    }

    getSharedCraftingTable(): Vec3 | null {
        return this.state.sharedCraftingTable;
    }

    setSharedCraftingTable(pos: Vec3) {
        this.state.sharedCraftingTable = pos;
    }

    getPendingRequests(): ResourceRequest[] {
        return this.state.pendingRequests;
    }
}
