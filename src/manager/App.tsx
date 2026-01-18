import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import { Header } from './components/Header';
import { BotList } from './components/BotList';
import { LogPanel } from './components/LogPanel';
import { RoleSelector } from './components/RoleSelector';
import { useBotManager } from './hooks/useBotManager';
import { useLogBuffer } from './hooks/useLogBuffer';
import { useFileWatcher } from './hooks/useFileWatcher';
import type { BotConfig, LogEntry, LogLevelName } from './types';
import { DEFAULT_BOT_CONFIGS, BOT_SPAWN_DELAY, LOG_LEVELS } from './types';

const LOG_LEVEL_ORDER: LogLevelName[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

interface AppProps {
  sessionId: string;
  initialConfigs?: BotConfig[];
  autoStart?: boolean;
}

type InputMode = 'normal' | 'add-bot';

export function App({ sessionId, initialConfigs = DEFAULT_BOT_CONFIGS, autoStart = true }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;

  // Calculate content height: total - header(2)
  const contentHeight = Math.max(5, terminalHeight - 2);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterBotName, setFilterBotName] = useState<string | null>(null);
  const [logLevelIndex, setLogLevelIndex] = useState(2); // Default to INFO
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const [addBotIndex, setAddBotIndex] = useState(0);

  const logLevelName = LOG_LEVEL_ORDER[logLevelIndex]!;
  const minLogLevel = LOG_LEVELS[logLevelName];

  const [logs, logActions] = useLogBuffer();

  const handleLog = useCallback((entry: LogEntry) => {
    logActions.addLog(entry);
  }, [logActions]);

  const [bots, botActions] = useBotManager({
    sessionId,
    initialConfigs,
    onLog: handleLog,
    getNextLogId: logActions.getNextId,
  });

  // Compute visual order: bots grouped by role, flattened to original indices
  // This matches the display order in BotList
  const visualOrder = useMemo(() => {
    const groups = new Map<string, number[]>();
    bots.forEach((bot, index) => {
      const role = bot.config.role;
      if (!groups.has(role)) {
        groups.set(role, []);
      }
      groups.get(role)!.push(index);
    });
    return Array.from(groups.values()).flat();
  }, [bots]);

  // File watcher for hot-reload
  const handleFileChange = useCallback((filename: string) => {
    // Add a log entry for the file change
    handleLog({
      id: logActions.getNextId(),
      timestamp: new Date(),
      botName: 'Manager',
      level: 30,
      message: `File changed: ${filename}, restarting all bots...`,
      extras: {},
      raw: '',
    });
    botActions.restartAll();
  }, [handleLog, logActions, botActions]);

  const [hotReloadEnabled, setHotReload] = useFileWatcher({
    enabled: false,
    onFileChange: handleFileChange,
  });

  // Auto-start bots on mount
  useEffect(() => {
    if (autoStart) {
      const startBots = async () => {
        for (let i = 0; i < bots.length; i++) {
          await botActions.startBot(bots[i]!.id);
          if (i < bots.length - 1) {
            await new Promise(resolve => setTimeout(resolve, BOT_SPAWN_DELAY));
          }
        }
      };
      startBots();
    }
  }, []); // Only run once on mount

  // All roles are always available (can have multiple of the same)
  const availableRoles = DEFAULT_BOT_CONFIGS;

  // Keyboard input handling
  useInput((input, key) => {
    if (inputMode === 'add-bot') {
      // RoleSelector handles its own input
      return;
    }

    // Navigation (follows visual grouped order)
    if (input === 'j' || key.downArrow) {
      setSelectedIndex(currentIndex => {
        const visualPos = visualOrder.indexOf(currentIndex);
        const nextVisualPos = Math.min(visualPos + 1, visualOrder.length - 1);
        return visualOrder[nextVisualPos] ?? currentIndex;
      });
    } else if (input === 'k' || key.upArrow) {
      setSelectedIndex(currentIndex => {
        const visualPos = visualOrder.indexOf(currentIndex);
        const prevVisualPos = Math.max(visualPos - 1, 0);
        return visualOrder[prevVisualPos] ?? currentIndex;
      });
    }

    // Bot actions
    else if (input === 's') {
      const bot = bots[selectedIndex];
      if (bot) botActions.startBot(bot.id);
    } else if (input === 'x') {
      const bot = bots[selectedIndex];
      if (bot) botActions.stopBot(bot.id);
    } else if (input === 'r') {
      const bot = bots[selectedIndex];
      if (bot) botActions.restartBot(bot.id);
    } else if (input === 'R') {
      botActions.restartAll();
    } else if (input === 'a') {
      setAddBotIndex(0);
      setInputMode('add-bot');
    } else if (input === 'd') {
      const bot = bots[selectedIndex];
      if (bot) {
        botActions.deleteBot(bot.id);
        // Select first bot after deletion (safe default)
        setSelectedIndex(0);
      }
    }

    // Hot-reload toggle
    else if (input === 'h') {
      setHotReload(!hotReloadEnabled);
      handleLog({
        id: logActions.getNextId(),
        timestamp: new Date(),
        botName: 'Manager',
        level: 30,
        message: `Hot-reload ${!hotReloadEnabled ? 'enabled' : 'disabled'}`,
        extras: {},
        raw: '',
      });
    }

    // Log actions
    else if (input === 'c') {
      logActions.clear();
    } else if (input === 'f') {
      if (filterBotName) {
        setFilterBotName(null);
      } else {
        const bot = bots[selectedIndex];
        if (bot && bot.name) setFilterBotName(bot.name);
      }
    } else if (input === 'l') {
      // Cycle through log levels
      setLogLevelIndex(i => (i + 1) % LOG_LEVEL_ORDER.length);
    }

    // Quit
    else if (input === 'q') {
      botActions.stopAll().then(() => {
        exit();
      });
    }
  });

  // Handle add bot from role selector - adds and auto-starts
  const handleAddBot = useCallback((config: BotConfig) => {
    const botId = botActions.addBot(config);
    handleLog({
      id: logActions.getNextId(),
      timestamp: new Date(),
      botName: 'Manager',
      level: 30,
      message: `Added bot: ${config.roleLabel}`,
      extras: {},
      raw: '',
    });
    setInputMode('normal');
    // Auto-start the new bot
    setTimeout(() => botActions.startBot(botId), 100);
  }, [botActions, handleLog, logActions]);

  const handleCancelAdd = useCallback(() => {
    setInputMode('normal');
  }, []);

  const handleAddBotNavigate = useCallback((delta: number) => {
    setAddBotIndex(i => Math.max(0, Math.min(i + delta, DEFAULT_BOT_CONFIGS.length - 1)));
  }, []);

  // Adjust content height when role selector is shown
  const effectiveContentHeight = inputMode === 'add-bot' ? contentHeight - 3 : contentHeight;

  return (
    <Box flexDirection="column">
      <Header sessionId={sessionId} hotReloadEnabled={hotReloadEnabled} />

      <Box height={effectiveContentHeight}>
        <BotList bots={bots} selectedIndex={selectedIndex} />
        <LogPanel logs={logs} filterBotName={filterBotName} minLevel={minLogLevel} levelName={logLevelName} height={effectiveContentHeight} />
      </Box>

      {inputMode === 'add-bot' && (
        <RoleSelector
          availableRoles={availableRoles}
          selectedIndex={addBotIndex}
          onSelect={handleAddBot}
          onCancel={handleCancelAdd}
          onNavigate={handleAddBotNavigate}
        />
      )}
    </Box>
  );
}
