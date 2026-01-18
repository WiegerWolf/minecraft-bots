import React from 'react';
import { Text } from 'ink';
import type { BotStatus } from '../types';

interface StatusIndicatorProps {
  status: BotStatus;
}

const statusConfig: Record<BotStatus, { char: string; color: string }> = {
  stopped: { char: 'S', color: 'gray' },
  starting: { char: '.', color: 'yellow' },
  running: { char: 'R', color: 'green' },
  crashed: { char: 'C', color: 'red' },
  restarting: { char: '.', color: 'yellow' },
};

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const config = statusConfig[status];
  return (
    <Text color={config.color}>[{config.char}]</Text>
  );
}
