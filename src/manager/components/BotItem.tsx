import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface BotItemProps {
  bot: ManagedBot;
  selected: boolean;
}

export function BotItem({ bot, selected }: BotItemProps) {
  // Show name if running/has name, otherwise show role label
  const displayName = bot.name || bot.config.roleLabel;

  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined}>
        {selected ? '> ' : '  '}
      </Text>
      <Text bold={selected}>
        {displayName.slice(0, 14).padEnd(14)}
      </Text>
      <StatusIndicator status={bot.status} />
    </Box>
  );
}
