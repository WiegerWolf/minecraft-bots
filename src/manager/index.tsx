#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { App } from './App';
import { generateSessionId } from '../shared/logger';
import { DEFAULT_BOT_CONFIGS, type BotConfig } from './types';

/**
 * Parse CLI arguments to determine which bot(s) to launch.
 * Usage: bun run start [bot-alias]
 *
 * Examples:
 *   bun run start           -> launches all bots
 *   bun run start farmer    -> launches only farmer bot
 */
function parseBotSelection(): BotConfig[] {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return DEFAULT_BOT_CONFIGS;
  }

  const alias = args[0]!.toLowerCase();

  const matchedConfig = DEFAULT_BOT_CONFIGS.find(config =>
    config.aliases.includes(alias) || config.role === alias
  );

  if (!matchedConfig) {
    console.error(`Unknown bot: ${alias}`);
    console.error(`Available bots: ${DEFAULT_BOT_CONFIGS.map(c => c.aliases.join('/')).join(', ')}`);
    process.exit(1);
  }

  return [matchedConfig];
}

const sessionId = generateSessionId();
const initialConfigs = parseBotSelection();

const { waitUntilExit } = render(
  <App
    sessionId={sessionId}
    initialConfigs={initialConfigs}
    autoStart={true}
  />
);

waitUntilExit().then(() => {
  process.exit(0);
});
