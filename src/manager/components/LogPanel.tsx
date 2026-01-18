import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { LogEntry } from '../types';
import { LogLine } from './LogLine';

interface LogPanelProps {
  logs: LogEntry[];
  filterBotLabel: string | null;
}

export function LogPanel({ logs, filterBotLabel }: LogPanelProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;

  // Reserve lines for header (2), help bar (2), and some padding
  const maxVisibleLogs = Math.max(5, terminalHeight - 6);

  const filteredLogs = useMemo(() => {
    const filtered = filterBotLabel
      ? logs.filter(log => log.botLabel === filterBotLabel)
      : logs;
    return filtered.slice(-maxVisibleLogs);
  }, [logs, filterBotLabel, maxVisibleLogs]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box>
        <Text bold underline>LOGS</Text>
        {filterBotLabel && (
          <Text dimColor> (filtered: {filterBotLabel})</Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1} overflowY="hidden">
        {filteredLogs.length === 0 ? (
          <Text dimColor>No logs yet...</Text>
        ) : (
          filteredLogs.map(entry => (
            <LogLine key={entry.id} entry={entry} />
          ))
        )}
      </Box>
    </Box>
  );
}
