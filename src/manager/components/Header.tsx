import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  sessionId: string;
  hotReloadEnabled: boolean;
}

export function Header({ sessionId, hotReloadEnabled }: HeaderProps) {
  return (
    <Box
      borderStyle="single"
      borderBottom={true}
      borderLeft={false}
      borderRight={false}
      borderTop={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text bold color="cyan">Minecraft Bot Manager</Text>
        <Text dimColor> [{sessionId}]</Text>
      </Box>
      <Box>
        <Text color="yellow">h</Text>
        <Text dimColor>otReload:</Text>
        <Text color={hotReloadEnabled ? 'green' : 'gray'}>{hotReloadEnabled ? 'ON' : 'off'}</Text>
        <Text> </Text>
        <Text color="yellow">q</Text>
        <Text dimColor>uit</Text>
      </Box>
    </Box>
  );
}
