import React from 'react';
import { Box, Text } from 'ink';
import type { ManagedBot, GoalUtility, ActionHistoryEntry, InventoryItem, WorldviewEntry, Worldview, GoalCooldown, TradeState, NeedState } from '../types';
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

function GoalItem({ goal, cooldown }: { goal: GoalUtility; cooldown?: GoalCooldown }) {
  const isCurrent = goal.isCurrent;
  const isDimmed = goal.isInvalid || goal.isZero;
  const isOnCooldown = !!cooldown;

  // Marker: ► for current, * for cooldown, · for others (all single-width)
  let marker = '·';
  let markerColor: string = 'gray';
  if (isCurrent) {
    marker = '►';
    markerColor = 'yellow';
  } else if (isOnCooldown) {
    marker = '*';
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

  // Calculate remaining cooldown time
  let cooldownText = '';
  if (cooldown) {
    const remaining = Math.max(0, cooldown.expiresAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    cooldownText = ` (${seconds}s)`;
  }

  return (
    <Box>
      <Text color={markerColor}>{marker} </Text>
      <Text color={color}>{goal.name.padEnd(20)} {goal.utility.toFixed(1).padStart(6)}</Text>
      {cooldownText && <Text color="cyan">{cooldownText}</Text>}
    </Box>
  );
}

function InventoryItemRow({ item, isOffered }: { item: InventoryItem; isOffered?: boolean }) {
  return (
    <Box>
      {item.isHeld ? (
        <Text color="yellow">► </Text>
      ) : isOffered ? (
        <Text color="cyan">$ </Text>
      ) : (
        <Text>  </Text>
      )}
      <Text color={item.isHeld ? 'yellow' : isOffered ? 'cyan' : 'white'}>{item.name}</Text>
      <Text dimColor> x{item.count}</Text>
      {isOffered && <Text color="cyan" dimColor> (for trade)</Text>}
    </Box>
  );
}

function TradeSection({ trade, needs }: { trade?: TradeState; needs?: NeedState }) {
  const hasActiveTrade = trade && trade.status !== 'idle';
  const hasOffers = trade && trade.wantedItems.length > 0;
  const hasOfferedItems = trade && trade.offeredItems.length > 0;
  const hasActiveNeeds = needs && needs.activeNeeds.length > 0;
  const hasIncomingNeeds = needs && needs.incomingNeeds.length > 0;

  const hasAnyTradeActivity = hasActiveTrade || hasOffers || hasOfferedItems || hasActiveNeeds || hasIncomingNeeds;

  if (!hasAnyTradeActivity) {
    return (
      <Box flexDirection="column">
        <Text bold underline>Trade & Needs</Text>
        <Text dimColor italic>No trade activity</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold underline>Trade & Needs</Text>
      <Box marginTop={1} flexDirection="column">
        {/* Active Trade */}
        {hasActiveTrade && trade && (
          <Box flexDirection="column" marginBottom={1}>
            <Box>
              <Text color="yellow">Active: </Text>
              <Text color="cyan">{trade.status}</Text>
              <Text dimColor> as </Text>
              <Text color={trade.role === 'giver' ? 'green' : 'magenta'}>{trade.role}</Text>
            </Box>
            {trade.partner && (
              <Box>
                <Text dimColor>  Partner: </Text>
                <Text>{trade.partner}</Text>
              </Box>
            )}
            {trade.item && (
              <Box>
                <Text dimColor>  Item: </Text>
                <Text>{trade.item} x{trade.quantity}</Text>
              </Box>
            )}
            {trade.meetingPoint && (
              <Box>
                <Text dimColor>  Meet: </Text>
                <Text>{trade.meetingPoint.x}, {trade.meetingPoint.y}, {trade.meetingPoint.z}</Text>
              </Box>
            )}
          </Box>
        )}

        {/* Offered Items (what we can trade away) */}
        {hasOfferedItems && trade && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="green">Offering:</Text>
            {trade.offeredItems.slice(0, 3).map((item, i) => (
              <Box key={i}>
                <Text dimColor>  </Text>
                <Text color="green">$ </Text>
                <Text>{item}</Text>
              </Box>
            ))}
            {trade.offeredItems.length > 3 && (
              <Text dimColor>  +{trade.offeredItems.length - 3} more</Text>
            )}
          </Box>
        )}

        {/* Available Offers (from other bots) */}
        {hasOffers && trade && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="magenta">Available:</Text>
            {trade.wantedItems.slice(0, 3).map((item, i) => (
              <Box key={i}>
                <Text dimColor>  </Text>
                <Text color="magenta">◄ </Text>
                <Text>{item}</Text>
              </Box>
            ))}
            {trade.wantedItems.length > 3 && (
              <Text dimColor>  +{trade.wantedItems.length - 3} more</Text>
            )}
          </Box>
        )}

        {/* Active Needs (requests we've made) */}
        {hasActiveNeeds && needs && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="yellow">Our Needs:</Text>
            {needs.activeNeeds.slice(0, 3).map((need, i) => (
              <Box key={i}>
                <Text dimColor>  </Text>
                <Text color="yellow">? </Text>
                <Text>{need.category}</Text>
                <Text dimColor> ({need.status})</Text>
                {need.offersCount > 0 && (
                  <Text color="green"> [{need.offersCount} offers]</Text>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Incoming Needs (requests from other bots) */}
        {hasIncomingNeeds && needs && (
          <Box flexDirection="column">
            <Text color="cyan">Incoming:</Text>
            {needs.incomingNeeds.slice(0, 3).map((need, i) => (
              <Box key={i}>
                <Text dimColor>  </Text>
                <Text color="cyan">! </Text>
                <Text>{need.from} needs {need.category}</Text>
                <Text dimColor> ({need.status})</Text>
              </Box>
            ))}
            {needs.incomingNeeds.length > 3 && (
              <Text dimColor>  +{needs.incomingNeeds.length - 3} more</Text>
            )}
          </Box>
        )}
      </Box>
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
                  cooldown={state.goalsOnCooldown.find(c => c.name === goal.name)}
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

        {/* Right Column: Worldview, Trade & Inventory */}
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

          {/* Trade & Needs */}
          <Box marginTop={2}>
            <TradeSection trade={state?.trade} needs={state?.needs} />
          </Box>

          {/* Inventory */}
          <Box marginTop={2} flexDirection="column">
            <Text bold underline>Inventory</Text>
            <Box marginTop={1} flexDirection="column">
              {state?.inventory && state.inventory.length > 0 ? (
                (() => {
                  // Get list of offered item names for highlighting
                  const offeredItemNames = new Set(
                    state.trade?.offeredItems?.map(s => s.split(' x')[0]) ?? []
                  );
                  return state.inventory.map((item, i) => (
                    <InventoryItemRow
                      key={i}
                      item={item}
                      isOffered={offeredItemNames.has(item.name)}
                    />
                  ));
                })()
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
