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
        {hotReloadEnabled && (
          <Text color="yellow"> [Hot-Reload]</Text>
        )}
      </Box>
      <Text dimColor>[{sessionId}]</Text>
    </Box>
  );
}
