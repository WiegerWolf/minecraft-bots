import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { LogEntry, LogLevelName } from '../types';
import { LogLine } from './LogLine';

interface LogPanelProps {
  logs: LogEntry[];
  filterBotName: string | null;
  minLevel: number;
  levelName: LogLevelName;
  height: number;
}

export function LogPanel({ logs, filterBotName, minLevel, levelName, height }: LogPanelProps) {
  // Reserve 2 lines for header
  const maxVisibleLogs = Math.max(1, height - 2);

  const filteredLogs = useMemo(() => {
    let filtered = logs.filter(log => log.level >= minLevel);
    if (filterBotName) {
      filtered = filtered.filter(log => log.botName === filterBotName);
    }
    return filtered.slice(-maxVisibleLogs);
  }, [logs, filterBotName, minLevel, maxVisibleLogs]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} height={height}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold underline>LOGS</Text>
          {filterBotName && (
            <Text color="cyan"> [{filterBotName}]</Text>
          )}
        </Box>
        <Box>
          <Text color="yellow">l</Text>
          <Text dimColor>evel:</Text>
          <Text color="green">{levelName} </Text>
          <Text color="yellow">f</Text>
          <Text dimColor>ilter </Text>
          <Text color="yellow">c</Text>
          <Text dimColor>lear</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
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
