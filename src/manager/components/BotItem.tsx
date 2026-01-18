import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot } from '../types';
import { getBotColor } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface BotItemProps {
  bot: ManagedBot;
  selected: boolean;
}

export function BotItem({ bot, selected }: BotItemProps) {
  // Show name if running/has name, otherwise show role label
  const displayName = bot.name || bot.config.roleLabel;
  // Use bot name for color if available, otherwise use role label
  const colorKey = bot.name || bot.config.roleLabel;
  const botColor = getBotColor(colorKey);

  return (
    <Box>
      <Text color={selected ? 'white' : undefined}>
        {selected ? '> ' : '  '}
      </Text>
      <Text color={botColor} bold={selected}>
        {displayName.slice(0, 14).padEnd(14)}
      </Text>
      <StatusIndicator status={bot.status} />
    </Box>
  );
}
