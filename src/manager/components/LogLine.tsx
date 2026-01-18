import React from 'react';
import { Text } from 'ink';
import type { LogEntry } from '../types';
import { getBotColor } from '../types';

interface LogLineProps {
  entry: LogEntry;
}

const levelConfig: Record<number, { icon: string; color: string }> = {
  10: { icon: 'TRC', color: 'gray' },
  20: { icon: 'DBG', color: 'cyan' },
  30: { icon: 'INF', color: 'green' },
  40: { icon: 'WRN', color: 'yellow' },
  50: { icon: 'ERR', color: 'red' },
  60: { icon: 'FTL', color: 'redBright' },
};

export function LogLine({ entry }: LogLineProps) {
  const time = entry.timestamp.toTimeString().slice(0, 8);
  const level = levelConfig[entry.level] || { icon: '???', color: 'white' };
  const botColor = getBotColor(entry.botName);

  // Build the log line as a single string to avoid layout shifts
  const component = entry.component ? `[${entry.component}]` : '';
  const extras = Object.keys(entry.extras).length > 0 ? ` ${formatExtras(entry.extras)}` : '';

  return (
    <Text wrap="truncate">
      <Text dimColor>{time} </Text>
      <Text color={level.color}>{level.icon} </Text>
      <Text color={botColor} bold>[{entry.botName}]</Text>
      <Text dimColor>{component}</Text>
      <Text> {entry.message}</Text>
      <Text dimColor>{extras}</Text>
    </Text>
  );
}

function formatExtras(extras: Record<string, unknown>): string {
  return Object.entries(extras)
    .map(([key, value]) => {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${key}=${valueStr}`;
    })
    .join(' ');
}
