import type { Bot } from 'mineflayer';
import type { VillageChat } from '../VillageChat';
import type { Logger } from '../logger';

export type BehaviorStatus = 'success' | 'failure' | 'running';

/**
 * Minimal blackboard interface required by BaseRequestMaterials.
 * Role-specific blackboards should extend this.
 */
export interface RequestMaterialsBlackboard {
    needsTools: boolean;
    villageChat: VillageChat | null;
    lastAction: string;
    log?: Logger | null;
}

/**
 * Configuration options for material request behavior.
 */
export interface RequestMaterialsConfig {
    /** Cooldown between requests in ms (default: 30000) */
    requestCooldownMs?: number;
    /** Resource type to request (default: 'log') */
    resourceType?: string;
    /** Amount to request (default: 2) */
    requestAmount?: number;
    /** Role label for logging (default: 'Bot') */
    roleLabel?: string;
    /** Log level for request message: 'info' or 'debug' (default: 'info') */
    logLevel?: 'info' | 'debug';
    /** Return status when request already pending (default: 'running') */
    pendingReturnStatus?: BehaviorStatus;
    /** Return status after making request (default: 'running') */
    requestedReturnStatus?: BehaviorStatus;
}

const DEFAULT_CONFIG: Required<RequestMaterialsConfig> = {
    requestCooldownMs: 30000,
    resourceType: 'log',
    requestAmount: 2,
    roleLabel: 'Bot',
    logLevel: 'info',
    pendingReturnStatus: 'running',
    requestedReturnStatus: 'running',
};

/**
 * Base class for requesting materials from other bots via village chat.
 *
 * Handles:
 * - Rate limiting requests
 * - Checking for pending requests
 * - Sending resource requests via village chat
 *
 * Subclasses must implement `hasSufficientMaterials()` to define when
 * the bot has enough materials and doesn't need to request more.
 *
 * Usage:
 * ```typescript
 * export class RequestMaterials extends BaseRequestMaterials<MyBlackboard> {
 *     constructor() {
 *         super({ roleLabel: 'Farmer', requestAmount: 2 });
 *     }
 *
 *     protected hasSufficientMaterials(bb: MyBlackboard): boolean {
 *         return bb.logCount >= 2 || (bb.stickCount >= 2 && bb.plankCount >= 2);
 *     }
 * }
 * ```
 */
export abstract class BaseRequestMaterials<TBlackboard extends RequestMaterialsBlackboard> {
    readonly name = 'RequestMaterials';
    protected config: Required<RequestMaterialsConfig>;
    private lastRequestTime = 0;

    constructor(config?: RequestMaterialsConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if the bot has sufficient materials and doesn't need to request more.
     * Subclasses must implement this based on their specific material requirements.
     */
    protected abstract hasSufficientMaterials(bb: TBlackboard): boolean;

    async tick(bot: Bot, bb: TBlackboard): Promise<BehaviorStatus> {
        // Only request if we need tools
        if (!bb.needsTools) return 'failure';

        // Check if we have enough materials already
        if (this.hasSufficientMaterials(bb)) return 'failure';

        // Need village chat to request
        if (!bb.villageChat) return 'failure';

        const now = Date.now();

        // Rate limit requests
        if (now - this.lastRequestTime < this.config.requestCooldownMs) {
            bb.lastAction = 'waiting_for_materials';
            return this.config.pendingReturnStatus;
        }

        // Check if we already have a pending request
        if (bb.villageChat.hasPendingRequestFor(this.config.resourceType)) {
            bb.lastAction = 'waiting_for_materials';
            return this.config.pendingReturnStatus;
        }

        bb.lastAction = 'request_materials';
        this.lastRequestTime = now;

        // Log and send request
        const message = `[${this.config.roleLabel}] Requesting ${this.config.requestAmount} ${this.config.resourceType}s from lumberjack`;
        if (this.config.logLevel === 'info') {
            bb.log?.info(message);
        } else {
            bb.log?.debug(message);
        }

        bb.villageChat.requestResource(this.config.resourceType, this.config.requestAmount);

        return this.config.requestedReturnStatus;
    }
}
