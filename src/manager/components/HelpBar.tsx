import React from 'react';
import { Box, Text } from 'ink';

export function HelpBar() {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      height={2}
    >
      <Text>
        <Text color="yellow">s</Text><Text dimColor>tart </Text>
        <Text color="yellow">x</Text><Text dimColor>stop </Text>
        <Text color="yellow">r</Text><Text dimColor>estart </Text>
        <Text color="yellow">R</Text><Text dimColor>estartAll </Text>
        <Text color="yellow">a</Text><Text dimColor>dd </Text>
        <Text color="yellow">d</Text><Text dimColor>el </Text>
        <Text color="yellow">h</Text><Text dimColor>otReload </Text>
        <Text color="yellow">c</Text><Text dimColor>lear </Text>
        <Text color="yellow">f</Text><Text dimColor>ilter </Text>
        <Text color="yellow">q</Text><Text dimColor>uit</Text>
      </Text>
    </Box>
  );
}
