import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot, BotState, GoalUtility, ActionHistoryEntry } from '../types';
import { getBotColor } from '../types';

interface StatePanelProps {
  bots: ManagedBot[];
  selectedIndex: number;
  height: number;
}

function BotStateView({ bot, isSelected }: { bot: ManagedBot; isSelected: boolean }) {
  const state = bot.state;
  const color = getBotColor(bot.name);
  const borderColor = isSelected ? 'cyan' : 'gray';

  if (bot.status !== 'running' || !state) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        marginBottom={1}
      >
        <Box>
          <Text color={color} bold>{bot.name || bot.config.roleLabel}</Text>
          <Text dimColor> [{bot.status}]</Text>
        </Box>
        <Text dimColor italic>
          {bot.status === 'stopped' ? 'Bot is stopped' :
           bot.status === 'starting' ? 'Starting...' :
           bot.status === 'crashed' ? 'Crashed, restarting...' :
           'Waiting for state...'}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box>
        <Text color={color} bold>{bot.name}</Text>
        <Text dimColor> [{bot.status}]</Text>
      </Box>

      {/* Current Goal & Action */}
      <Box marginTop={1}>
        <Text bold>Goal: </Text>
        {state.currentGoal ? (
          <>
            <Text color="green">{state.currentGoal}</Text>
            <Text dimColor> ({state.currentGoalUtility.toFixed(1)})</Text>
          </>
        ) : (
          <Text dimColor italic>idle</Text>
        )}
      </Box>

      <Box>
        <Text bold>Action: </Text>
        {state.currentAction ? (
          <>
            <Text color="cyan">{state.currentAction}</Text>
            {state.actionProgress && (
              <Text dimColor> [{state.actionProgress.current}/{state.actionProgress.total}]</Text>
            )}
            <Text dimColor> {state.planProgress.toFixed(0)}%</Text>
          </>
        ) : (
          <Text dimColor italic>none</Text>
        )}
      </Box>

      {/* Stats */}
      <Box marginTop={1}>
        <Text dimColor>Stats: </Text>
        <Text color="green">{state.stats.actionsSucceeded}</Text>
        <Text dimColor>/</Text>
        <Text>{state.stats.actionsExecuted}</Text>
        <Text dimColor> ok, </Text>
        <Text color={state.stats.actionsFailed > 0 ? 'red' : 'gray'}>{state.stats.actionsFailed}</Text>
        <Text dimColor> fail, </Text>
        <Text color={state.stats.replansRequested > 0 ? 'yellow' : 'gray'}>{state.stats.replansRequested}</Text>
        <Text dimColor> replan</Text>
      </Box>

      {/* Action History */}
      {state.actionHistory.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Recent:</Text>
          {state.actionHistory.slice(0, 5).map((entry, i) => (
            <ActionHistoryItem key={i} entry={entry} />
          ))}
        </Box>
      )}

      {/* Top Goals */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Goals:</Text>
        {state.goalUtilities.slice(0, 5).map((goal, i) => (
          <GoalItem key={i} goal={goal} />
        ))}
      </Box>

      {/* Cooldowns */}
      {state.goalsOnCooldown.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Cooldown: </Text>
          <Text color="yellow">{state.goalsOnCooldown.join(', ')}</Text>
        </Box>
      )}
    </Box>
  );
}

function ActionHistoryItem({ entry }: { entry: ActionHistoryEntry }) {
  const icon = entry.success ? '✓' : '✗';
  const color = entry.success ? 'green' : 'red';
  const failInfo = entry.failureCount && entry.failureCount > 1 ? ` (${entry.failureCount}x)` : '';

  return (
    <Box>
      <Text color={color}> {icon} </Text>
      <Text>{entry.action}</Text>
      {failInfo && <Text color="red">{failInfo}</Text>}
    </Box>
  );
}

function GoalItem({ goal }: { goal: GoalUtility }) {
  let color: string = 'white';
  let suffix = '';

  if (goal.isCurrent) {
    color = 'cyan';
    suffix = ' ←';
  } else if (goal.isInvalid) {
    color = 'gray';
    suffix = ' [INVALID]';
  } else if (goal.isZero) {
    color = 'gray';
  }

  return (
    <Box>
      <Text color={color}> {goal.name}: {goal.utility.toFixed(1)}</Text>
      <Text color="yellow">{suffix}</Text>
    </Box>
  );
}

export function StatePanel({ bots, selectedIndex, height }: StatePanelProps) {
  // Get running bots to display
  const botsToShow = bots.filter(b => b.status === 'running' || b.state);

  // If no running bots, show all
  const displayBots = botsToShow.length > 0 ? botsToShow : bots;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} height={height}>
      <Box justifyContent="space-between">
        <Text bold underline>BOT STATE</Text>
        <Box>
          <Text dimColor>Live view</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {displayBots.length === 0 ? (
          <Text dimColor>No bots running...</Text>
        ) : (
          displayBots.map((bot, i) => (
            <BotStateView
              key={bot.id}
              bot={bot}
              isSelected={bots.indexOf(bot) === selectedIndex}
            />
          ))
        )}
      </Box>
    </Box>
  );
}
