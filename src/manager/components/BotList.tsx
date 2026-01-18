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
      width={24}
      minWidth={24}
      flexShrink={0}
      borderStyle="single"
      borderRight={true}
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box flexDirection="column">
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
      <Box flexDirection="column">
        <Text dimColor>─────────────────────</Text>
        <Text>
          <Text color="yellow">s</Text><Text dimColor>tart </Text>
          <Text color="yellow">x</Text><Text dimColor>stop </Text>
          <Text color="yellow">r</Text><Text dimColor>estart</Text>
        </Text>
        <Text>
          <Text color="yellow">a</Text><Text dimColor>dd </Text>
          <Text color="yellow">d</Text><Text dimColor>elete </Text>
          <Text color="yellow">R</Text><Text dimColor>estartAll</Text>
        </Text>
      </Box>
    </Box>
  );
}
