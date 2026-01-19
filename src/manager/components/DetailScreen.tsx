import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot, GoalUtility, ActionHistoryEntry, InventoryItem, WorldviewEntry, Worldview } from '../types';
import { getBotColor } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface DetailScreenProps {
  bot: ManagedBot;
  sessionId: string;
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

function GoalItem({ goal, isOnCooldown }: { goal: GoalUtility; isOnCooldown?: boolean }) {
  const isCurrent = goal.isCurrent;
  const isDimmed = goal.isInvalid || goal.isZero;

  // Marker: ► for current (like equipped item), ❄ for cooldown, space otherwise
  let marker = '  ';
  let markerColor: string | undefined;
  if (isCurrent) {
    marker = '► ';
    markerColor = 'yellow';
  } else if (isOnCooldown) {
    marker = '❄ ';
    markerColor = 'cyan';
  }

  // Color: yellow for current, cyan for cooldown, dim for invalid/zero
  let color: string = 'white';
  if (isCurrent) {
    color = 'yellow';
  } else if (isOnCooldown) {
    color = 'cyan';
  } else if (isDimmed) {
    color = 'gray';
  }

  return (
    <Box>
      <Text color={markerColor}>{marker}</Text>
      <Text color={color}>{goal.name.padEnd(20)} {goal.utility.toFixed(1).padStart(6)}</Text>
    </Box>
  );
}

function InventoryItemRow({ item }: { item: InventoryItem }) {
  return (
    <Box>
      {item.isHeld ? (
        <Text color="yellow">► </Text>
      ) : (
        <Text>  </Text>
      )}
      <Text color={item.isHeld ? 'yellow' : 'white'}>{item.name}</Text>
      <Text dimColor> x{item.count}</Text>
    </Box>
  );
}

function WorldviewRow({ entries, compact = false }: { entries: WorldviewEntry[]; compact?: boolean }) {
  return (
    <Box flexWrap="wrap">
      {entries.map((entry, i) => {
        const valueStr = typeof entry.value === 'boolean'
          ? (entry.value ? 'Y' : 'N')
          : String(entry.value);
        const color = entry.color as string | undefined;
        return (
          <Box key={i} marginRight={compact ? 1 : 2}>
            <Text dimColor>{entry.label}:</Text>
            <Text color={color}>{valueStr}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function WorldviewSection({ worldview }: { worldview: Worldview }) {
  return (
    <Box flexDirection="column">
      <Text bold underline>Worldview</Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>Nearby  </Text>
          <WorldviewRow entries={worldview.nearby} compact />
        </Box>
        <Box>
          <Text dimColor>Inv     </Text>
          <WorldviewRow entries={worldview.inventory} compact />
        </Box>
        <Box>
          <Text dimColor>Pos     </Text>
          <WorldviewRow entries={worldview.positions} compact />
        </Box>
        <Box>
          <Text dimColor>Flags   </Text>
          <WorldviewRow entries={worldview.flags} compact />
        </Box>
      </Box>
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
        {/* Left Column: Goals & Actions */}
        <Box flexDirection="column" width="50%" paddingRight={2}>
          {/* Goal Utilities */}
          <Text bold underline>Goals</Text>
          <Box marginTop={1} flexDirection="column">
            {state?.goalUtilities ? (
              state.goalUtilities.map((goal, i) => (
                <GoalItem
                  key={i}
                  goal={goal}
                  isOnCooldown={state.goalsOnCooldown.includes(goal.name)}
                />
              ))
            ) : (
              <Text dimColor italic>No goal data</Text>
            )}
          </Box>

          {/* Current Action */}
          <Box marginTop={2} flexDirection="column">
            <Text bold underline>Action</Text>
            <Box marginTop={1}>
              {state?.currentAction ? (
                <>
                  <Text color="cyan">{state.currentAction}</Text>
                  {state.actionProgress && (
                    <Text dimColor> [{state.actionProgress.current}/{state.actionProgress.total}]</Text>
                  )}
                </>
              ) : (
                <Text dimColor italic>idle</Text>
              )}
            </Box>
          </Box>

          {/* Action History */}
          <Box marginTop={2} flexDirection="column">
            <Text bold underline>History</Text>
            <Box marginTop={1} flexDirection="column">
              {state?.actionHistory && state.actionHistory.length > 0 ? (
                state.actionHistory.slice(0, 8).map((entry, i) => (
                  <ActionHistoryItem key={i} entry={entry} />
                ))
              ) : (
                <Text dimColor italic>No history</Text>
              )}
            </Box>
          </Box>
        </Box>

        {/* Right Column: Worldview & Inventory */}
        <Box flexDirection="column" width="50%">
          {/* Worldview */}
          {state?.worldview ? (
            <WorldviewSection worldview={state.worldview} />
          ) : (
            <>
              <Text bold underline>Worldview</Text>
              <Text dimColor italic>No worldview data</Text>
            </>
          )}

          {/* Inventory */}
          <Box marginTop={2} flexDirection="column">
            <Text bold underline>Inventory</Text>
            <Box marginTop={1} flexDirection="column">
              {state?.inventory && state.inventory.length > 0 ? (
                state.inventory.map((item, i) => (
                  <InventoryItemRow key={i} item={item} />
                ))
              ) : (
                <Text dimColor italic>Empty</Text>
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
