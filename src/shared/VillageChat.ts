import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Logger } from './logger';

/**
 * Chat-based village communication system.
 * Bots communicate via in-game chat using prefixed messages.
 *
 * Message formats:
 * - [VILLAGE] center <x> <y> <z>           - Announce village center
 * - [CHEST] shared <x> <y> <z>             - Announce shared chest location
 * - [REQUEST] <item> <quantity>            - Request resources
 * - [FULFILL] <item> <quantity> for <bot>  - Announce fulfilled request
 * - [DEPOSIT] <item> <quantity>            - Announce deposit to shared chest
 * - [STATUS] <role> at <x> <y> <z>         - Periodic status update
 *
 * Trade protocol messages:
 * - [OFFER] <item> <quantity>              - "I have stuff I don't need"
 * - [WANT] <item> <quantity> from <bot> (have <count>) - "I'll take that, here's my count"
 * - [TRADE_ACCEPT] <partner>               - "You won, let's trade" (after 5s window)
 * - [TRADE_AT] <x> <y> <z>                 - "Meet me here"
 * - [TRADE_READY]                          - "I'm at the meeting point"
 * - [TRADE_DROPPED]                        - "Items dropped, I stepped back"
 * - [TRADE_DONE]                           - "Trade complete"
 * - [TRADE_CANCEL]                         - "Trade cancelled"
 */

export interface ResourceRequest {
    from: string;
    item: string;
    quantity: number;
    timestamp: number;
}

export interface DepositNotification {
    from: string;
    item: string;
    quantity: number;
    timestamp: number;
}

export interface TerraformRequest {
    from: string;
    position: Vec3;
    timestamp: number;
    status: 'pending' | 'claimed' | 'done';
    claimedBy?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADE PROTOCOL INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An offer to trade items.
 * Broadcast by bots that have items they don't need.
 */
export interface TradeOffer {
    from: string;
    item: string;
    quantity: number;
    timestamp: number;
}

/**
 * Response to a trade offer indicating desire to receive the items.
 */
export interface WantResponse {
    from: string;
    currentCount: number;  // How many the responder already has (for "neediest" selection)
    timestamp: number;
}

/**
 * Trade status values for tracking progress through the state machine.
 */
export type TradeStatus =
    | 'idle'
    | 'offering'       // Giver: broadcast offer, collecting WANT responses
    | 'wanting'        // Receiver: sent WANT, waiting to be selected
    | 'accepted'       // Trade partner selected, about to travel
    | 'traveling'      // Moving to meeting point
    | 'ready'          // At meeting point, waiting for partner
    | 'dropping'       // Giver: dropping items
    | 'picking_up'     // Receiver: picking up items
    | 'done'           // Trade complete
    | 'cancelled';     // Trade was cancelled

/**
 * Active trade state for tracking an in-progress trade.
 */
export interface ActiveTrade {
    partner: string;
    item: string;
    quantity: number;
    meetingPoint: Vec3 | null;
    role: 'giver' | 'receiver';
    status: TradeStatus;
    partnerReady: boolean;
    wantResponses: WantResponse[];  // Collected during 5s window (giver only)
    offerTimestamp: number;         // When offer was made (for timeout)
}

export interface VillageChatState {
    villageCenter: Vec3 | null;
    sharedChest: Vec3 | null;
    sharedCraftingTable: Vec3 | null;
    pendingRequests: ResourceRequest[];
    lastDepositNotification: DepositNotification | null;
    pendingTerraformRequests: TerraformRequest[];

    // Trade state
    activeOffers: TradeOffer[];       // Offers from other bots
    activeTrade: ActiveTrade | null;  // Current trade (if any)
}

export class VillageChat {
    private state: VillageChatState = {
        villageCenter: null,
        sharedChest: null,
        sharedCraftingTable: null,
        pendingRequests: [],
        lastDepositNotification: null,
        pendingTerraformRequests: [],
        activeOffers: [],
        activeTrade: null,
    };

    private bot: Bot;
    private log: Logger | null = null;
    private onRequestCallback: ((request: ResourceRequest) => void) | null = null;
    private onTerraformRequestCallback: ((request: TerraformRequest) => void) | null = null;
    private onTerraformDoneCallback: ((pos: Vec3) => void) | null = null;

    // Trade callbacks
    private onTradeOfferCallback: ((offer: TradeOffer) => void) | null = null;
    private onTradeAcceptCallback: ((partner: string, item: string, quantity: number) => void) | null = null;
    private onTradeMeetingPointCallback: ((pos: Vec3) => void) | null = null;
    private onTradePartnerReadyCallback: (() => void) | null = null;
    private onTradeDroppedCallback: (() => void) | null = null;
    private onTradeDoneCallback: (() => void) | null = null;
    private onTradeCancelCallback: (() => void) | null = null;

    constructor(bot: Bot, logger?: Logger) {
        this.bot = bot;
        this.log = logger ?? null;
        this.setupChatListener();
    }

    private setupChatListener() {
        this.bot.on('chat', (username: string, message: string) => {
            // Ignore own messages
            if (username === this.bot.username) return;

            // Debug: log all received village-related chat
            if (message.startsWith('[')) {
                this.log?.debug({ from: username, message }, 'Received village chat');
            }

            // Parse village messages
            if (message.startsWith('[VILLAGE] center ')) {
                const match = message.match(/\[VILLAGE\] center (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    if (!this.state.villageCenter) {
                        this.state.villageCenter = pos;
                        this.log?.info({ from: username, pos: pos.toString() }, 'Learned village center');
                    }
                }
            }

            // Parse shared chest messages
            if (message.startsWith('[CHEST] shared ')) {
                const match = message.match(/\[CHEST\] shared (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    this.state.sharedChest = pos;
                    this.log?.info({ from: username, pos: pos.toString() }, 'Learned shared chest');
                }
            }

            // Parse shared crafting table messages
            if (message.startsWith('[CRAFTING] shared ')) {
                const match = message.match(/\[CRAFTING\] shared (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    this.state.sharedCraftingTable = pos;
                    this.log?.info({ from: username, pos: pos.toString() }, 'Learned shared crafting table');
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
                        this.log?.info({ from: username, item: request.item, quantity: request.quantity }, 'Resource request received');
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
                    this.log?.info({ from: username, item, forBot }, 'Request fulfilled');
                }
            }

            // Parse deposit notifications
            if (message.startsWith('[DEPOSIT] ')) {
                const match = message.match(/\[DEPOSIT\] (\w+) (\d+)/);
                if (match) {
                    const notification: DepositNotification = {
                        from: username,
                        item: match[1]!,
                        quantity: parseInt(match[2]!),
                        timestamp: Date.now()
                    };
                    this.state.lastDepositNotification = notification;
                    this.log?.info({ from: username, item: notification.item, quantity: notification.quantity }, 'Deposit notification received');
                }
            }

            // Parse terraform request
            if (message.startsWith('[TERRAFORM] ')) {
                const match = message.match(/\[TERRAFORM\] (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    // Avoid duplicate requests at same position
                    const existing = this.state.pendingTerraformRequests.find(r =>
                        r.position.distanceTo(pos) < 5 && r.status !== 'done'
                    );
                    if (!existing) {
                        const request: TerraformRequest = {
                            from: username,
                            position: pos,
                            timestamp: Date.now(),
                            status: 'pending'
                        };
                        this.state.pendingTerraformRequests.push(request);
                        this.log?.info({ from: username, pos: pos.toString() }, 'Terraform request received');
                        if (this.onTerraformRequestCallback) {
                            this.onTerraformRequestCallback(request);
                        }
                    }
                }
            }

            // Parse terraform claim
            if (message.startsWith('[TERRAFORM_CLAIM] ')) {
                const match = message.match(/\[TERRAFORM_CLAIM\] (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    const request = this.state.pendingTerraformRequests.find(r =>
                        r.position.distanceTo(pos) < 5 && r.status === 'pending'
                    );
                    if (request) {
                        request.status = 'claimed';
                        request.claimedBy = username;
                        this.log?.info({ from: username, pos: pos.toString() }, 'Terraform claimed');
                    }
                }
            }

            // Parse terraform done
            if (message.startsWith('[TERRAFORM_DONE] ')) {
                const match = message.match(/\[TERRAFORM_DONE\] (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    const request = this.state.pendingTerraformRequests.find(r =>
                        r.position.distanceTo(pos) < 5 && (r.status === 'pending' || r.status === 'claimed')
                    );
                    if (request) {
                        request.status = 'done';
                        this.log?.info({ from: username, pos: pos.toString() }, 'Terraform completed');
                        if (this.onTerraformDoneCallback) {
                            this.onTerraformDoneCallback(pos);
                        }
                    }
                }
            }

            // Parse terraform release (claim released, back to pending)
            if (message.startsWith('[TERRAFORM_RELEASE] ')) {
                const match = message.match(/\[TERRAFORM_RELEASE\] (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    const request = this.state.pendingTerraformRequests.find(r =>
                        r.position.distanceTo(pos) < 5 && r.status === 'claimed'
                    );
                    if (request) {
                        request.status = 'pending';
                        request.claimedBy = undefined;
                        this.log?.info({ from: username, pos: pos.toString() }, 'Terraform claim released');
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // TRADE PROTOCOL PARSING
            // ═══════════════════════════════════════════════════════════════

            // Parse trade offer: [OFFER] oak_log 4
            if (message.startsWith('[OFFER] ')) {
                const match = message.match(/\[OFFER\] (\S+) (\d+)/);
                if (match) {
                    const offer: TradeOffer = {
                        from: username,
                        item: match[1]!,
                        quantity: parseInt(match[2]!),
                        timestamp: Date.now(),
                    };
                    // Remove any stale offers from same bot
                    this.state.activeOffers = this.state.activeOffers.filter(o => o.from !== username);
                    this.state.activeOffers.push(offer);
                    this.log?.info({ from: username, item: offer.item, qty: offer.quantity }, 'Trade offer received');
                    this.onTradeOfferCallback?.(offer);
                }
            }

            // Parse want response: [WANT] oak_log 4 from Farmer (have 2)
            if (message.startsWith('[WANT] ')) {
                const match = message.match(/\[WANT\] (\S+) (\d+) from (\S+) \(have (\d+)\)/);
                if (match) {
                    const item = match[1]!;
                    const quantity = parseInt(match[2]!);
                    const targetBot = match[3]!;
                    const currentCount = parseInt(match[4]!);

                    // Only process if this is directed at us (we're the offerer)
                    if (targetBot === this.bot.username && this.state.activeTrade?.status === 'offering') {
                        const response: WantResponse = {
                            from: username,
                            currentCount,
                            timestamp: Date.now(),
                        };
                        this.state.activeTrade.wantResponses.push(response);
                        this.log?.debug({ from: username, item, qty: quantity, have: currentCount }, 'Trade want received');
                    }
                }
            }

            // Parse trade accept: [TRADE_ACCEPT] Lumberjack
            if (message.startsWith('[TRADE_ACCEPT] ')) {
                const match = message.match(/\[TRADE_ACCEPT\] (\S+)/);
                if (match) {
                    const selectedPartner = match[1]!;
                    // Check if we were selected
                    if (selectedPartner === this.bot.username && this.state.activeTrade?.status === 'wanting') {
                        this.state.activeTrade.status = 'accepted';
                        this.state.activeTrade.partner = username;
                        this.log?.info({ from: username }, 'We were selected for trade');
                        // Find the offer to get item/quantity
                        const offer = this.state.activeOffers.find(o => o.from === username);
                        if (offer) {
                            this.state.activeTrade.item = offer.item;
                            this.state.activeTrade.quantity = offer.quantity;
                            this.onTradeAcceptCallback?.(username, offer.item, offer.quantity);
                        }
                    }
                    // Remove the offer (it's been accepted)
                    this.state.activeOffers = this.state.activeOffers.filter(o => o.from !== username);
                }
            }

            // Parse meeting point: [TRADE_AT] 100 64 200
            if (message.startsWith('[TRADE_AT] ')) {
                const match = message.match(/\[TRADE_AT\] (-?\d+) (-?\d+) (-?\d+)/);
                if (match) {
                    const pos = new Vec3(parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!));
                    // Only process if we're in an accepted trade with this partner
                    if (this.state.activeTrade?.partner === username &&
                        (this.state.activeTrade?.status === 'accepted' || this.state.activeTrade?.status === 'wanting')) {
                        this.state.activeTrade.meetingPoint = pos;
                        this.state.activeTrade.status = 'traveling';
                        this.log?.info({ from: username, pos: pos.toString() }, 'Trade meeting point received');
                        this.onTradeMeetingPointCallback?.(pos);
                    }
                }
            }

            // Parse ready: [TRADE_READY]
            if (message === '[TRADE_READY]') {
                if (this.state.activeTrade?.partner === username) {
                    this.state.activeTrade.partnerReady = true;
                    this.log?.debug({ from: username }, 'Trade partner ready');
                    this.onTradePartnerReadyCallback?.();
                }
            }

            // Parse dropped: [TRADE_DROPPED]
            if (message === '[TRADE_DROPPED]') {
                if (this.state.activeTrade?.partner === username && this.state.activeTrade.role === 'receiver') {
                    this.state.activeTrade.status = 'picking_up';
                    this.log?.info({ from: username }, 'Trade items dropped, picking up');
                    this.onTradeDroppedCallback?.();
                }
            }

            // Parse done: [TRADE_DONE]
            if (message === '[TRADE_DONE]') {
                if (this.state.activeTrade?.partner === username) {
                    this.log?.info({ from: username }, 'Trade completed by partner');
                    this.onTradeDoneCallback?.();
                    // Clear trade state
                    this.state.activeTrade = null;
                }
            }

            // Parse cancel: [TRADE_CANCEL]
            if (message === '[TRADE_CANCEL]') {
                if (this.state.activeTrade?.partner === username ||
                    this.state.activeOffers.some(o => o.from === username)) {
                    this.log?.info({ from: username }, 'Trade cancelled');
                    this.onTradeCancelCallback?.();
                    // Remove offer and clear trade
                    this.state.activeOffers = this.state.activeOffers.filter(o => o.from !== username);
                    if (this.state.activeTrade?.partner === username) {
                        this.state.activeTrade = null;
                    }
                }
            }
        });
    }

    // Called when another bot makes a resource request
    onRequest(callback: (request: ResourceRequest) => void) {
        this.onRequestCallback = callback;
    }

    // Called when another bot makes a terraform request
    onTerraformRequest(callback: (request: TerraformRequest) => void) {
        this.onTerraformRequestCallback = callback;
    }

    // Called when terraform is completed
    onTerraformDone(callback: (pos: Vec3) => void) {
        this.onTerraformDoneCallback = callback;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TRADE CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════════

    // Called when another bot broadcasts a trade offer
    onTradeOffer(callback: (offer: TradeOffer) => void) {
        this.onTradeOfferCallback = callback;
    }

    // Called when we are selected as the trade partner
    onTradeAccept(callback: (partner: string, item: string, quantity: number) => void) {
        this.onTradeAcceptCallback = callback;
    }

    // Called when we receive a meeting point
    onTradeMeetingPoint(callback: (pos: Vec3) => void) {
        this.onTradeMeetingPointCallback = callback;
    }

    // Called when trade partner is ready at meeting point
    onTradePartnerReady(callback: () => void) {
        this.onTradePartnerReadyCallback = callback;
    }

    // Called when trade items have been dropped (for receiver)
    onTradeDropped(callback: () => void) {
        this.onTradeDroppedCallback = callback;
    }

    // Called when trade is done
    onTradeDone(callback: () => void) {
        this.onTradeDoneCallback = callback;
    }

    // Called when trade is cancelled
    onTradeCancel(callback: () => void) {
        this.onTradeCancelCallback = callback;
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

    // Announce a deposit to the shared chest
    announceDeposit(item: string, quantity: number) {
        const msg = `[DEPOSIT] ${item} ${quantity}`;
        this.bot.chat(msg);
    }

    // Request terraforming at a position
    requestTerraform(pos: Vec3) {
        // Check if we already have a pending request at this position
        const existing = this.state.pendingTerraformRequests.find(r =>
            r.position.distanceTo(pos) < 5 && r.status !== 'done'
        );
        if (existing) {
            return; // Already requested
        }

        const request: TerraformRequest = {
            from: this.bot.username,
            position: pos.clone(),
            timestamp: Date.now(),
            status: 'pending'
        };
        this.state.pendingTerraformRequests.push(request);

        const msg = `[TERRAFORM] ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
    }

    // Claim a terraform request
    claimTerraformRequest(pos: Vec3) {
        const request = this.state.pendingTerraformRequests.find(r =>
            r.position.distanceTo(pos) < 5 && r.status === 'pending'
        );
        if (request) {
            request.status = 'claimed';
            request.claimedBy = this.bot.username;
        }

        const msg = `[TERRAFORM_CLAIM] ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
    }

    // Release a terraform claim (set back to pending for retry)
    releaseTerraformClaim(pos: Vec3) {
        const request = this.state.pendingTerraformRequests.find(r =>
            r.position.distanceTo(pos) < 5 && r.status === 'claimed'
        );
        if (request) {
            request.status = 'pending';
            request.claimedBy = undefined;
        }
        // Broadcast so other bots know it's available again
        const msg = `[TERRAFORM_RELEASE] ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
    }

    // Announce terraform completion
    announceTerraformDone(pos: Vec3) {
        const request = this.state.pendingTerraformRequests.find(r =>
            r.position.distanceTo(pos) < 5 && (r.status === 'pending' || r.status === 'claimed')
        );
        if (request) {
            request.status = 'done';
        }

        const msg = `[TERRAFORM_DONE] ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
    }

    // Get pending terraform requests (not claimed or done)
    getPendingTerraformRequests(): TerraformRequest[] {
        return this.state.pendingTerraformRequests.filter(r => r.status === 'pending');
    }

    // Check if there's an active terraform request at position
    hasTerraformRequestAt(pos: Vec3): boolean {
        return this.state.pendingTerraformRequests.some(r =>
            r.position.distanceTo(pos) < 5 && r.status !== 'done'
        );
    }

    // Check if terraform is done at position
    isTerraformDoneAt(pos: Vec3): boolean {
        return this.state.pendingTerraformRequests.some(r =>
            r.position.distanceTo(pos) < 5 && r.status === 'done'
        );
    }

    // Clean up old terraform requests
    cleanupOldTerraformRequests(maxAge: number = 10 * 60 * 1000) {
        const now = Date.now();
        this.state.pendingTerraformRequests = this.state.pendingTerraformRequests.filter(r =>
            r.status !== 'done' || now - r.timestamp < maxAge
        );
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

    getLastDepositNotification(): DepositNotification | null {
        return this.state.lastDepositNotification;
    }

    // Check if there are pending requests that this bot could fulfill
    hasPendingRequestsToFulfill(canProvide: string[]): boolean {
        return this.state.pendingRequests.some(r =>
            r.from !== this.bot.username &&
            canProvide.some(item => r.item.includes(item) || item.includes(r.item))
        );
    }

    // Get all terraform requests
    getAllTerraformRequests(): TerraformRequest[] {
        return this.state.pendingTerraformRequests;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TRADE MESSAGE SENDING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Broadcast a trade offer for items we don't need.
     * Starts the giver flow: OFFERING state, collecting WANT responses.
     */
    broadcastTradeOffer(item: string, quantity: number): void {
        // Don't offer if already in a trade
        if (this.state.activeTrade && this.state.activeTrade.status !== 'idle') {
            this.log?.debug('Cannot offer: already in a trade');
            return;
        }

        // Set up active trade state as giver
        this.state.activeTrade = {
            partner: '',
            item,
            quantity,
            meetingPoint: null,
            role: 'giver',
            status: 'offering',
            partnerReady: false,
            wantResponses: [],
            offerTimestamp: Date.now(),
        };

        const msg = `[OFFER] ${item} ${quantity}`;
        this.bot.chat(msg);
        this.log?.info({ item, qty: quantity }, 'Broadcast trade offer');
    }

    /**
     * Respond to a trade offer indicating we want the items.
     * Starts the receiver flow: WANTING state, waiting to be selected.
     */
    sendWantResponse(offer: TradeOffer, currentCount: number): void {
        // Don't respond if already in a trade
        if (this.state.activeTrade && this.state.activeTrade.status !== 'idle') {
            this.log?.debug('Cannot respond to offer: already in a trade');
            return;
        }

        // Set up active trade state as receiver
        this.state.activeTrade = {
            partner: offer.from,
            item: offer.item,
            quantity: offer.quantity,
            meetingPoint: null,
            role: 'receiver',
            status: 'wanting',
            partnerReady: false,
            wantResponses: [],
            offerTimestamp: offer.timestamp,
        };

        const msg = `[WANT] ${offer.item} ${offer.quantity} from ${offer.from} (have ${currentCount})`;
        this.bot.chat(msg);
        this.log?.info({ item: offer.item, from: offer.from, have: currentCount }, 'Sent want response');
    }

    /**
     * Accept a trade with the neediest bot (called by giver after 5s window).
     */
    acceptTrade(partner: string): void {
        if (!this.state.activeTrade || this.state.activeTrade.status !== 'offering') {
            this.log?.debug('Cannot accept trade: not in offering state');
            return;
        }

        this.state.activeTrade.partner = partner;
        this.state.activeTrade.status = 'accepted';

        const msg = `[TRADE_ACCEPT] ${partner}`;
        this.bot.chat(msg);
        this.log?.info({ partner }, 'Accepted trade with partner');
    }

    /**
     * Send the meeting point location (called by giver after accepting).
     */
    sendMeetingPoint(pos: Vec3): void {
        if (!this.state.activeTrade) return;

        this.state.activeTrade.meetingPoint = pos.clone();
        this.state.activeTrade.status = 'traveling';

        const msg = `[TRADE_AT] ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
        this.bot.chat(msg);
        this.log?.info({ pos: pos.toString() }, 'Sent trade meeting point');
    }

    /**
     * Signal that we're ready at the meeting point.
     */
    sendTradeReady(): void {
        if (!this.state.activeTrade) return;

        this.state.activeTrade.status = 'ready';

        const msg = '[TRADE_READY]';
        this.bot.chat(msg);
        this.log?.debug('Sent trade ready');
    }

    /**
     * Signal that items have been dropped (called by giver).
     */
    sendTradeDropped(): void {
        if (!this.state.activeTrade) return;

        this.state.activeTrade.status = 'done';

        const msg = '[TRADE_DROPPED]';
        this.bot.chat(msg);
        this.log?.info('Sent trade dropped');
    }

    /**
     * Signal that trade is complete.
     */
    sendTradeDone(): void {
        const msg = '[TRADE_DONE]';
        this.bot.chat(msg);
        this.log?.info('Sent trade done');

        // Clear trade state
        this.state.activeTrade = null;
    }

    /**
     * Cancel the current trade.
     */
    cancelTrade(): void {
        if (!this.state.activeTrade) return;

        const msg = '[TRADE_CANCEL]';
        this.bot.chat(msg);
        this.log?.info('Cancelled trade');

        // Clear trade state
        this.state.activeTrade = null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TRADE GETTERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get all active trade offers from other bots.
     */
    getActiveOffers(): TradeOffer[] {
        return this.state.activeOffers;
    }

    /**
     * Get offers for a specific item.
     */
    getOffersForItem(itemName: string): TradeOffer[] {
        return this.state.activeOffers.filter(o =>
            o.item === itemName || o.item.includes(itemName) || itemName.includes(o.item)
        );
    }

    /**
     * Get the current active trade (if any).
     */
    getActiveTrade(): ActiveTrade | null {
        return this.state.activeTrade;
    }

    /**
     * Check if currently in a trade.
     */
    isInTrade(): boolean {
        return this.state.activeTrade !== null && this.state.activeTrade.status !== 'idle';
    }

    /**
     * Check if we're in the offering phase (collecting WANT responses).
     */
    isOffering(): boolean {
        return this.state.activeTrade?.status === 'offering';
    }

    /**
     * Get all WANT responses collected during offering phase.
     */
    getWantResponses(): WantResponse[] {
        return this.state.activeTrade?.wantResponses ?? [];
    }

    /**
     * Select the neediest bot from WANT responses.
     * Returns the bot with the lowest current count.
     */
    selectNeediestBot(): WantResponse | null {
        const responses = this.state.activeTrade?.wantResponses ?? [];
        if (responses.length === 0) return null;

        return responses.reduce((neediest, current) =>
            current.currentCount < neediest.currentCount ? current : neediest
        );
    }

    /**
     * Clean up stale trade offers (older than maxAge).
     */
    cleanupOldTradeOffers(maxAge: number = 60000): void {
        const now = Date.now();
        this.state.activeOffers = this.state.activeOffers.filter(o =>
            now - o.timestamp < maxAge
        );
    }

    /**
     * Get the trade meeting point.
     * Defaults to village center + offset, or spawn position + offset.
     */
    getTradeMeetingPoint(spawnPos: Vec3): Vec3 {
        const center = this.state.villageCenter;
        if (center) {
            return center.offset(3, 0, 3);
        }
        return spawnPos.offset(3, 0, 3);
    }

    /**
     * Set trade status directly (for manual state management).
     */
    setTradeStatus(status: TradeStatus): void {
        if (this.state.activeTrade) {
            this.state.activeTrade.status = status;
        }
    }

    /**
     * Clear the active trade state.
     */
    clearActiveTrade(): void {
        this.state.activeTrade = null;
    }
}
