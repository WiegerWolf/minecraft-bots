# Minecraft Bots

![Minecraft Base Timelapse](media/minecraft-timelapse.gif)

Autonomous Minecraft bots built with mineflayer and Bun. Features GOAP (Goal-Oriented Action Planning) for intelligent decision-making and multi-bot coordination.

## Quick Start

```bash
# Install dependencies
bun install

# Start all bots (farmer, lumberjack, landscaper)
bun run start

# Start a single bot
bun run start farmer
bun run start lumberjack
bun run start landscaper

# Development with watch mode
bun run dev:farmer
bun run dev:lumberjack
bun run dev:landscaper
```

## Available Roles

| Role | Description |
|------|-------------|
| `goap-farming` | Autonomous farmer - tills, plants, harvests, crafts tools |
| `goap-lumberjack` | Chops trees, processes wood, fulfills resource requests |
| `goap-landscaper` | Terraforms areas, levels terrain around farms |

## Commands

The bots respond to in-game chat commands:

- `farm` / `farm stop` - Start/stop farming role
- `lumber` / `lumber stop` - Start/stop lumberjack role
- `landscape` / `landscape stop` - Start/stop landscaper role
- `come` - Bot comes to your position
- `stop` - Stop all activities

## Project Structure

```
src/
├── index.ts              # Process manager with hot-reload
├── bot.ts                # Main bot instance
├── roles/
│   ├── GOAPRole.ts       # Base class for GOAP roles
│   ├── GOAPFarmingRole.ts
│   ├── GOAPLumberjackRole.ts
│   ├── GOAPLandscaperRole.ts
│   └── farming/          # Behavior tree farming (legacy)
├── planning/
│   ├── GOAPPlanner.ts    # A* action planning
│   ├── GoalArbiter.ts    # Goal selection with hysteresis
│   ├── PlanExecutor.ts   # Plan execution and monitoring
│   ├── WorldState.ts     # Immutable planning state
│   └── actions/          # GOAP actions per role
├── shared/
│   ├── logger.ts         # Pino-based structured logging
│   ├── VillageChat.ts    # Inter-bot communication
│   └── PathfindingUtils.ts
└── logs/                 # Log output (auto-created)
    └── YYYY-MM-DD/
        └── BotName.log
```

## Logging

The project uses [Pino](https://github.com/pinojs/pino) for structured logging:

- **Console**: Pretty-printed with pino-pretty during development
- **Files**: JSON format in `logs/YYYY-MM-DD/BotName.log`
- **Log levels**: `error`, `warn`, `info`, `debug`

Control log level via environment variable:
```bash
LOG_LEVEL=debug bun run start farmer
```

## Documentation

See the [docs/](docs/) folder for detailed documentation:

- [Architecture](docs/architecture.md) - GOAP vs behavior trees, design decisions
- [GOAP Planning](docs/goap-planning.md) - How goal-oriented planning works
- [State Management](docs/state-management.md) - Blackboard vs WorldState
- [Multi-Bot Coordination](docs/multi-bot-coordination.md) - Village chat protocol
- [Failure Handling](docs/failure-handling.md) - Recovery strategies

## Development

```bash
# Type check
bunx tsc --noEmit

# Run single bot with watch
bun run dev:farmer
```

## Key Libraries

- `mineflayer` - Minecraft bot framework
- `mineflayer-pathfinder` - A* pathfinding
- `pino` / `pino-pretty` - Structured logging
- `vec3` - 3D vector math
- `prismarine-*` - Minecraft data types

## License

MIT
