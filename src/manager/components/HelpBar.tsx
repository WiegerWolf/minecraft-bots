import React from 'react';
import { Box, Text } from 'ink';

interface HelpBarProps {
  logFilterActive: boolean;
}

export function HelpBar({ logFilterActive }: HelpBarProps) {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      gap={1}
      flexWrap="wrap"
    >
      <Shortcut key="s" keyChar="s" label="start" />
      <Shortcut key="x" keyChar="x" label="stop" />
      <Shortcut key="r" keyChar="r" label="restart" />
      <Shortcut key="R" keyChar="R" label="restart all" />
      <Shortcut key="a" keyChar="a" label="add" />
      <Shortcut key="d" keyChar="d" label="delete" />
      <Shortcut key="h" keyChar="h" label="hot-reload" />
      <Shortcut key="c" keyChar="c" label="clear" />
      <Shortcut key="f" keyChar="f" label={logFilterActive ? 'show all' : 'filter'} />
      <Shortcut key="q" keyChar="q" label="quit" />
    </Box>
  );
}

function Shortcut({ keyChar, label }: { keyChar: string; label: string }) {
  return (
    <Box>
      <Text color="yellow">[{keyChar}]</Text>
      <Text dimColor>{label}</Text>
    </Box>
  );
}
