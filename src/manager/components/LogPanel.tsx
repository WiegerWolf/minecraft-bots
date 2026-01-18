import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { LogEntry } from '../types';
import { LogLine } from './LogLine';

interface LogPanelProps {
  logs: LogEntry[];
  filterBotLabel: string | null;
  height: number;
}

export function LogPanel({ logs, filterBotLabel, height }: LogPanelProps) {
  // Reserve 2 lines for header ("LOGS" + margin)
  const maxVisibleLogs = Math.max(1, height - 2);

  const filteredLogs = useMemo(() => {
    const filtered = filterBotLabel
      ? logs.filter(log => log.botLabel === filterBotLabel)
      : logs;
    return filtered.slice(-maxVisibleLogs);
  }, [logs, filterBotLabel, maxVisibleLogs]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} height={height}>
      <Box>
        <Text bold underline>LOGS</Text>
        {filterBotLabel && (
          <Text dimColor> (filtered: {filterBotLabel})</Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
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
