import React from 'react';
import { Box, Text } from 'ink';
import type { LogEntry } from '../types';

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

const botColors = ['blue', 'magenta', 'cyan', 'green', 'yellow'] as const;
const botColorMap = new Map<string, typeof botColors[number]>();
let colorIndex = 0;

function getBotColor(botLabel: string): typeof botColors[number] {
  if (!botColorMap.has(botLabel)) {
    botColorMap.set(botLabel, botColors[colorIndex % botColors.length]!);
    colorIndex++;
  }
  return botColorMap.get(botLabel)!;
}

export function LogLine({ entry }: LogLineProps) {
  const time = entry.timestamp.toTimeString().slice(0, 8);
  const level = levelConfig[entry.level] || { icon: '???', color: 'white' };
  const botColor = getBotColor(entry.botLabel);

  return (
    <Box>
      <Text dimColor>{time} </Text>
      <Text color={level.color}>{level.icon} </Text>
      <Text color={botColor} bold>[{entry.botLabel}]</Text>
      {entry.component && <Text dimColor>[{entry.component}]</Text>}
      <Text> {entry.message}</Text>
      {Object.keys(entry.extras).length > 0 && (
        <Text dimColor> {formatExtras(entry.extras)}</Text>
      )}
    </Box>
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
