import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { ManagedBot } from '../types';
import { getBotColor } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface OverviewScreenProps {
  bots: ManagedBot[];
  selectedIndex: number;
  hotReloadEnabled: boolean;
  sessionId: string;
}

function ProgressBar({ progress, width = 10 }: { progress: number; width?: number }) {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return (
    <Text>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
    </Text>
  );
}

function BotCard({ bot, selected }: { bot: ManagedBot; selected: boolean }) {
  const state = bot.state;
  const color = getBotColor(bot.name || bot.config.roleLabel);
  const borderColor = selected ? 'cyan' : 'gray';

  // Card width - adjust based on content
  const cardWidth = 36;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      width={cardWidth}
      paddingX={1}
      marginRight={1}
      marginBottom={1}
    >
      {/* Header: Name + Status */}
      <Box justifyContent="space-between">
        <Text color={color} bold>
          {(bot.name || bot.config.roleLabel).slice(0, 20)}
        </Text>
        <StatusIndicator status={bot.status} />
      </Box>

      {/* Goal */}
      <Box>
        <Text dimColor>Goal: </Text>
        {state?.currentGoal ? (
          <Text color="green">{state.currentGoal.slice(0, 18)}</Text>
        ) : (
          <Text dimColor italic>
            {bot.status === 'running' ? 'idle' : '-'}
          </Text>
        )}
      </Box>

      {/* Action */}
      <Box>
        <Text dimColor>Act: </Text>
        {state?.currentAction ? (
          <Text color="cyan">{state.currentAction.slice(0, 19)}</Text>
        ) : (
          <Text dimColor italic>-</Text>
        )}
      </Box>

      {/* Stats */}
      <Box>
        <Text dimColor>Stats: </Text>
        {state ? (
          <>
            <Text color="green">{state.stats.actionsSucceeded}</Text>
            <Text dimColor>/</Text>
            <Text>{state.stats.actionsExecuted}</Text>
            <Text dimColor> ok </Text>
            <Text color={state.stats.actionsFailed > 0 ? 'red' : 'gray'}>
              {state.stats.actionsFailed}
            </Text>
            <Text dimColor> fail</Text>
          </>
        ) : (
          <Text dimColor italic>-</Text>
        )}
      </Box>

      {/* Progress */}
      <Box>
        <Text dimColor>Progress: </Text>
        {state ? (
          <>
            <ProgressBar progress={state.planProgress} width={8} />
            <Text dimColor> {state.planProgress.toFixed(0)}%</Text>
          </>
        ) : (
          <Text dimColor italic>-</Text>
        )}
      </Box>
    </Box>
  );
}

export function OverviewScreen({ bots, selectedIndex, hotReloadEnabled, sessionId }: OverviewScreenProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  // Calculate how many cards fit per row (card width ~38 with margin)
  const cardWidth = 38;
  const cardsPerRow = Math.max(1, Math.floor(terminalWidth / cardWidth));

  // Group bots into rows
  const rows = useMemo(() => {
    const result: ManagedBot[][] = [];
    for (let i = 0; i < bots.length; i += cardsPerRow) {
      result.push(bots.slice(i, i + cardsPerRow));
    }
    return result;
  }, [bots, cardsPerRow]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text bold color="cyan">Minecraft Bot Manager</Text>
          <Text dimColor> [{sessionId}]</Text>
        </Box>
        <Box>
          <Text color="yellow">h</Text>
          <Text dimColor>otReload:</Text>
          <Text color={hotReloadEnabled ? 'green' : 'red'}>
            {hotReloadEnabled ? 'on' : 'off'}
          </Text>
          <Text> </Text>
          <Text color="yellow">q</Text>
          <Text dimColor>uit</Text>
        </Box>
      </Box>

      {/* Bot Grid */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {bots.length === 0 ? (
          <Text dimColor>No bots configured. Press 'a' to add a bot.</Text>
        ) : (
          rows.map((row, rowIndex) => (
            <Box key={rowIndex} flexDirection="row">
              {row.map((bot, colIndex) => {
                const botIndex = rowIndex * cardsPerRow + colIndex;
                return (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    selected={botIndex === selectedIndex}
                  />
                );
              })}
            </Box>
          ))
        )}
      </Box>

      {/* Footer with shortcuts */}
      <Box paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Box flexGrow={1}>
          <Text color="yellow">↑↓←→</Text>
          <Text dimColor>/</Text>
          <Text color="yellow">hjkl</Text>
          <Text dimColor> navigate </Text>
          <Text color="yellow">Enter</Text>
          <Text dimColor> details </Text>
          <Text color="yellow">s</Text>
          <Text dimColor>tart </Text>
          <Text color="yellow">x</Text>
          <Text dimColor>stop </Text>
          <Text color="yellow">r</Text>
          <Text dimColor>estart </Text>
          <Text color="yellow">R</Text>
          <Text dimColor>estartAll </Text>
          <Text color="yellow">a</Text>
          <Text dimColor>dd </Text>
          <Text color="yellow">d</Text>
          <Text dimColor>elete</Text>
        </Box>
      </Box>
    </Box>
  );
}
