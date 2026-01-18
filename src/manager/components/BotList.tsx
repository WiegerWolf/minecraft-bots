import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot } from '../types';
import { BotItem } from './BotItem';

interface BotListProps {
  bots: ManagedBot[];
  selectedIndex: number;
}

interface RoleGroup {
  role: string;
  roleLabel: string;
  bots: { bot: ManagedBot; originalIndex: number }[];
}

export function BotList({ bots, selectedIndex }: BotListProps) {
  // Group bots by role while preserving original indices for selection
  const groupedBots = useMemo(() => {
    const groups = new Map<string, RoleGroup>();

    bots.forEach((bot, index) => {
      const role = bot.config.role;
      if (!groups.has(role)) {
        groups.set(role, {
          role,
          roleLabel: bot.config.roleLabel,
          bots: [],
        });
      }
      groups.get(role)!.bots.push({ bot, originalIndex: index });
    });

    return Array.from(groups.values());
  }, [bots]);

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
          {groupedBots.length === 0 ? (
            <Text dimColor>No bots</Text>
          ) : (
            groupedBots.map((group) => (
              <Box key={group.role} flexDirection="column">
                <Text dimColor>┌ {group.roleLabel} ({group.bots.length})</Text>
                {group.bots.map(({ bot, originalIndex }) => (
                  <BotItem
                    key={bot.id}
                    bot={bot}
                    selected={originalIndex === selectedIndex}
                  />
                ))}
              </Box>
            ))
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
