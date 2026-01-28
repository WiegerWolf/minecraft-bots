import mineflayer, { type Bot, type BotOptions } from 'mineflayer';
import pathfinder, {
    GoalNear,
    createTaskRunner,
    FoodChain,
    MobDefenseChain,
    MLGBucketChain,
    WorldSurvivalChain,
    type TaskRunner,
} from 'baritone-ts';
import { faker } from '@faker-js/faker';
import { Vec3 } from 'vec3';
import { GOAPFarmingRole } from './roles/GOAPFarmingRole';
import { GOAPLumberjackRole } from './roles/GOAPLumberjackRole';
import { GOAPLandscaperRole } from './roles/GOAPLandscaperRole';
import type { Role } from './roles/Role';
import { createBotLogger, createChildLogger, type Logger } from './shared/logger';

// Track spawn position for persistent knowledge system
let spawnPosition: Vec3 | null = null;

// Read configuration from environment variables (set by manager)
const BOT_ROLE = process.env.BOT_ROLE || 'farming';
const BOT_NAME = process.env.BOT_NAME || faker.internet.username().slice(0, 16);
const ROLE_LABEL = process.env.ROLE_LABEL || 'Bot';
const SESSION_ID = process.env.SESSION_ID || new Date().toISOString().replace(/[:.]/g, '-');

// Create bot-wide logger
const logger: Logger = createBotLogger({
    botName: BOT_NAME,
    role: BOT_ROLE,
    roleLabel: ROLE_LABEL,
    sessionId: SESSION_ID,
});
const botLog = createChildLogger(logger, 'Bot');

// Global error handlers to catch silent crashes
process.on('unhandledRejection', (reason: any) => {
    botLog.fatal({ err: reason, stack: reason?.stack }, 'Unhandled promise rejection - crashing');
    console.error('Unhandled rejection:', reason);
    process.exit(1);
});

process.on('uncaughtException', (err: Error) => {
    botLog.fatal({ err, stack: err.stack }, 'Uncaught exception - crashing');
    console.error('Uncaught exception:', err);
    process.exit(1);
});

botLog.info({ botName: BOT_NAME, role: BOT_ROLE }, 'Bot starting');

const config: BotOptions = {
    host: 'localhost',
    port: 25565,
    username: BOT_NAME,
    version: undefined,
};

const bot: Bot = mineflayer.createBot(config);

// Register all available roles (all using GOAP)
// Keys must match BOT_ROLE values sent by the manager (see manager/types.ts)
const roles: Record<string, Role> = {
    'goap-farming': new GOAPFarmingRole({ debug: true, logger }),
    'goap-lumberjack': new GOAPLumberjackRole({ debug: true, logger }),
    'landscaper': new GOAPLandscaperRole({ debug: true, logger }),
};

let currentRole: Role | null = null;
let taskRunner: TaskRunner | null = null;

function setRole(roleName: string | null, options?: any) {
    if (currentRole) {
        currentRole.stop(bot);
    }

    if (roleName && roles[roleName]) {
        currentRole = roles[roleName];
        currentRole.start(bot, options);
    } else {
        currentRole = null;
    }
}

bot.once('spawn', () => {
    // Keep console.log for this message - manager watches for it to reset backoff
    console.log('✅ Bot has spawned!');
    botLog.info('Bot spawned');

    // Initialize baritone-ts pathfinder (must be after spawn when bot.inventory exists)
    // Type assertion needed because baritone-ts has its own mineflayer dependency
    pathfinder(bot as any, {
        canDig: true,
        allowParkour: true,
        allowSprint: true,
    });

    // Initialize TaskRunner with survival chains for automatic safety behaviors
    // These run alongside GOAP and only interrupt for safety (eating, combat, hazards)
    taskRunner = createTaskRunner(bot as any);

    // FoodChain: Auto-eat when hungry (priority 55, above user tasks)
    const foodChain = new FoodChain(bot as any, {
        eatWhenHunger: 14,      // Start eating at 14/20 hunger (7 drumsticks)
        eatRottenFlesh: true,   // Allow rotten flesh as emergency food
        rottenFleshPenalty: 5,  // But prefer other foods
    });
    taskRunner.registerChain(foodChain);

    // MobDefenseChain: Handle hostile mobs (priority 100, high priority)
    // Using a passive approach - flee from threats rather than fight
    const mobDefenseChain = new MobDefenseChain(bot as any, {
        detectionRange: 12,     // Detect hostiles within 12 blocks
        engageRange: 0,         // Don't engage - flee instead
        creeperFleeDistance: 12,
        threatThreshold: 5,     // React to lower threats
    });
    taskRunner.registerChain(mobDefenseChain);

    // MLGBucketChain: Water bucket fall protection (priority 100)
    // Uses physics-based prediction and cone casting for accurate timing
    const mlgBucketChain = new MLGBucketChain(bot as any, {
        triggerVelocity: -0.7,  // Trigger when falling at this velocity
        lookAheadBlocks: 40,    // Max look-ahead for landing prediction
        bucketCooldown: 0.25,   // Time between bucket attempts
    });
    taskRunner.registerChain(mlgBucketChain);

    // WorldSurvivalChain: Escape hazards like lava, fire, suffocation
    // Automatically detects all hazard types and attempts escape
    const worldSurvivalChain = new WorldSurvivalChain(bot as any, {
        drowningThreshold: 3,   // Air bubbles before drowning action
        portalStuckTicks: 100,  // Ticks stuck before shimmy escape
        voidLevel: -64,         // Y level considered void
    });
    taskRunner.registerChain(worldSurvivalChain);

    // Start the task runner (attaches to physics tick)
    taskRunner.start();
    botLog.info('Survival chains initialized (food, mob defense, MLG bucket, world survival)');

    // Capture spawn position for persistent knowledge system (signs at spawn)
    spawnPosition = bot.entity.position.clone();
    botLog.info({ spawnPosition: spawnPosition.toString() }, 'Captured spawn position');

    // Auto-start the configured role after a short delay
    bot.waitForTicks(40).then(() => {
        botLog.info({ role: BOT_ROLE }, 'Auto-starting role');
        setRole(BOT_ROLE, { logger, spawnPosition });
    });
});

bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;

    const args = message.trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    // Manual role control commands (useful for debugging)
    if (command === 'farm') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'stop') {
            setRole(null);
            bot.chat("Stopped farming.");
        } else {
            const player = bot.players[username];
            const position = player?.entity?.position;
            setRole('farming', position ? { center: position } : undefined);
            bot.chat("Starting farming logic.");
        }
    }

    if (command === 'lumber' || command === 'lumberjack') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'stop') {
            setRole(null);
            bot.chat("Stopped lumberjack.");
        } else {
            setRole('lumberjack');
            bot.chat("Starting lumberjack logic.");
        }
    }

    if (command === 'landscape' || command === 'landscaper') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'stop') {
            setRole(null);
            bot.chat("Stopped landscaper.");
        } else {
            setRole('landscaper');
            bot.chat("Starting landscaper logic.");
        }
    }

    if (command === 'come') {
        const player = bot.players[username];
        const position = player?.entity?.position;
        if (position) {
            bot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, 1));
            bot.chat("Coming to you!");
        }
    }

    if (command === 'stop') {
        setRole(null);
        bot.pathfinder.stop();
        bot.chat("Stopped all activities.");
    }
});

// Track connection state explicitly
let isConnected = false;

bot.on('spawn', () => { isConnected = true; });
bot.on('kicked', (reason) => {
    isConnected = false;
    botLog.error({ reason }, 'Kicked from server');
    process.exit(1);
});
bot.on('error', (err) => {
    botLog.error({ err }, 'Bot error');
    // Don't exit on error - might be recoverable
});
bot.on('end', () => {
    isConnected = false;
    botLog.warn('Disconnected from server');
    process.exit(1);
});

// Export connection check for roles to use
export function isBotConnected(): boolean {
    if (!isConnected) return false;
    // Also check if the underlying socket is alive
    try {
        const client = (bot as any)._client;
        if (!client || !client.socket || client.socket.destroyed) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}


// --- GRACEFUL SHUTDOWN LOGIC ---

let isDropping = false;

async function emergencyDropAndExit() {
    if (isDropping) return;
    isDropping = true;

    botLog.warn('Termination signal received, initiating emergency inventory dump');

    // 1. Stop all bot actions
    setRole(null);
    if (taskRunner) {
        taskRunner.stop();
        taskRunner = null;
    }
    bot.pathfinder.stop();
    bot.clearControlStates();

    // 2. Drop everything
    const items = bot.inventory.items();
    if (items.length > 0) {
        try {
            // Look down to drop at feet
            await bot.look(bot.entity.yaw, -Math.PI / 2, true);

            for (const item of items) {
                try {
                    await bot.tossStack(item);
                } catch (e) {
                    botLog.error({ item: item.name }, 'Failed to drop item');
                }
            }
        } catch (e) {
            botLog.error({ err: e }, 'Error during drop sequence');
        }
    }

    botLog.info('Inventory cleared, exiting');
    process.exit(0);
}

// Listen for kill signals from the manager
process.on('SIGINT', emergencyDropAndExit);
process.on('SIGTERM', emergencyDropAndExit);
