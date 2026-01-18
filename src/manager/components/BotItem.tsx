import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface BotItemProps {
  bot: ManagedBot;
  selected: boolean;
}

export function BotItem({ bot, selected }: BotItemProps) {
  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined}>
        {selected ? '> ' : '  '}
      </Text>
      <Text bold={selected}>
        {bot.config.roleLabel.padEnd(8)}
      </Text>
      <Text> </Text>
      <StatusIndicator status={bot.status} />
    </Box>
  );
}
