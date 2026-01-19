import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot, GoalUtility, ActionHistoryEntry } from '../types';
import { getBotColor } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface DetailScreenProps {
  bot: ManagedBot;
  sessionId: string;
}

function ProgressBar({ progress, width = 20 }: { progress: number; width?: number }) {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return (
    <Text>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text> {progress.toFixed(0)}%</Text>
    </Text>
  );
}

function ActionHistoryItem({ entry }: { entry: ActionHistoryEntry }) {
  const icon = entry.success ? '✓' : '✗';
  const color = entry.success ? 'green' : 'red';
  const failInfo = entry.failureCount && entry.failureCount > 1 ? ` (${entry.failureCount}x)` : '';
  const time = new Date(entry.timestamp).toLocaleTimeString();

  return (
    <Box>
      <Text dimColor>{time} </Text>
      <Text color={color}>{icon} </Text>
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
    suffix = ' ← CURRENT';
  } else if (goal.isInvalid) {
    color = 'gray';
    suffix = ' [INVALID]';
  } else if (goal.isZero) {
    color = 'gray';
    suffix = ' [ZERO]';
  }

  return (
    <Box>
      <Text color={color}>  {goal.name.padEnd(20)} {goal.utility.toFixed(1).padStart(6)}</Text>
      <Text color="yellow">{suffix}</Text>
    </Box>
  );
}

export function DetailScreen({ bot, sessionId }: DetailScreenProps) {
  const state = bot.state;
  const color = getBotColor(bot.name || bot.config.roleLabel);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false}>
        <Box>
          <Text color={color} bold>{bot.name || bot.config.roleLabel}</Text>
          <Text> </Text>
          <StatusIndicator status={bot.status} />
          <Text dimColor> [{sessionId}]</Text>
        </Box>
        <Box>
          <Text color="yellow">Esc</Text>
          <Text dimColor>/</Text>
          <Text color="yellow">Backspace</Text>
          <Text dimColor> back </Text>
          <Text color="yellow">s</Text>
          <Text dimColor>tart </Text>
          <Text color="yellow">x</Text>
          <Text dimColor>stop </Text>
          <Text color="yellow">r</Text>
          <Text dimColor>estart</Text>
        </Box>
      </Box>

      {/* Content */}
      <Box flexDirection="row" flexGrow={1} paddingX={1} marginTop={1}>
        {/* Left Column: Current State */}
        <Box flexDirection="column" width="50%" paddingRight={2}>
          <Text bold underline>Current State</Text>

          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text bold>Goal: </Text>
              {state?.currentGoal ? (
                <>
                  <Text color="green">{state.currentGoal}</Text>
                  <Text dimColor> (utility: {state.currentGoalUtility.toFixed(1)})</Text>
                </>
              ) : (
                <Text dimColor italic>idle</Text>
              )}
            </Box>

            <Box>
              <Text bold>Action: </Text>
              {state?.currentAction ? (
                <>
                  <Text color="cyan">{state.currentAction}</Text>
                  {state.actionProgress && (
                    <Text dimColor> [{state.actionProgress.current}/{state.actionProgress.total}]</Text>
                  )}
                </>
              ) : (
                <Text dimColor italic>none</Text>
              )}
            </Box>

            <Box marginTop={1}>
              <Text bold>Plan Progress: </Text>
              {state ? (
                <ProgressBar progress={state.planProgress} width={20} />
              ) : (
                <Text dimColor>-</Text>
              )}
            </Box>
          </Box>

          {/* Stats */}
          <Box marginTop={2} flexDirection="column">
            <Text bold underline>Statistics</Text>
            {state ? (
              <Box marginTop={1} flexDirection="column">
                <Text>
                  Actions executed: <Text color="white">{state.stats.actionsExecuted}</Text>
                </Text>
                <Text>
                  Actions succeeded: <Text color="green">{state.stats.actionsSucceeded}</Text>
                </Text>
                <Text>
                  Actions failed: <Text color={state.stats.actionsFailed > 0 ? 'red' : 'gray'}>{state.stats.actionsFailed}</Text>
                </Text>
                <Text>
                  Replans requested: <Text color={state.stats.replansRequested > 0 ? 'yellow' : 'gray'}>{state.stats.replansRequested}</Text>
                </Text>
                {state.stats.actionsExecuted > 0 && (
                  <Text dimColor>
                    Success rate: {((state.stats.actionsSucceeded / state.stats.actionsExecuted) * 100).toFixed(1)}%
                  </Text>
                )}
              </Box>
            ) : (
              <Text dimColor italic>No statistics available</Text>
            )}
          </Box>

          {/* Cooldowns */}
          {state && state.goalsOnCooldown.length > 0 && (
            <Box marginTop={2} flexDirection="column">
              <Text bold underline>Goals on Cooldown</Text>
              <Box marginTop={1}>
                <Text color="yellow">{state.goalsOnCooldown.join(', ')}</Text>
              </Box>
            </Box>
          )}
        </Box>

        {/* Right Column: Goals & History */}
        <Box flexDirection="column" width="50%">
          {/* Goal Utilities */}
          <Text bold underline>Goal Utilities</Text>
          <Box marginTop={1} flexDirection="column">
            {state?.goalUtilities ? (
              state.goalUtilities.map((goal, i) => (
                <GoalItem key={i} goal={goal} />
              ))
            ) : (
              <Text dimColor italic>No goal data available</Text>
            )}
          </Box>

          {/* Action History */}
          <Box marginTop={2} flexDirection="column">
            <Text bold underline>Recent Actions</Text>
            <Box marginTop={1} flexDirection="column">
              {state?.actionHistory && state.actionHistory.length > 0 ? (
                state.actionHistory.slice(0, 10).map((entry, i) => (
                  <ActionHistoryItem key={i} entry={entry} />
                ))
              ) : (
                <Text dimColor italic>No action history</Text>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Footer showing last update */}
      {state && (
        <Box paddingX={1}>
          <Text dimColor>Last update: {new Date(state.lastUpdate).toLocaleTimeString()}</Text>
        </Box>
      )}
    </Box>
  );
}
