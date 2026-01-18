import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot } from '../types';
import { BotItem } from './BotItem';

interface BotListProps {
  bots: ManagedBot[];
  selectedIndex: number;
}

export function BotList({ bots, selectedIndex }: BotListProps) {
  return (
    <Box
      flexDirection="column"
      width={20}
      minWidth={20}
      flexShrink={0}
      borderStyle="single"
      borderRight={true}
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      paddingX={1}
    >
      <Text bold underline>BOTS</Text>
      <Box flexDirection="column" marginTop={1}>
        {bots.map((bot, index) => (
          <BotItem
            key={bot.id}
            bot={bot}
            selected={index === selectedIndex}
          />
        ))}
        {bots.length === 0 && (
          <Text dimColor>No bots</Text>
        )}
      </Box>
    </Box>
  );
}
