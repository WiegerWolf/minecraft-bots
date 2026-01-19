import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import { OverviewScreen } from './components/OverviewScreen';
import { DetailScreen } from './components/DetailScreen';
import { RoleSelector } from './components/RoleSelector';
import { useBotManager } from './hooks/useBotManager';
import { useLogBuffer } from './hooks/useLogBuffer';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useRestartTrigger } from './hooks/useRestartTrigger';
import { useMemoryProfiler } from './hooks/useMemoryProfiler';
import type { BotConfig, LogEntry } from './types';
import { DEFAULT_BOT_CONFIGS, BOT_SPAWN_DELAY } from './types';

/**
 * Set the terminal window title using ANSI escape sequences.
 * Works on most terminal emulators (xterm, iTerm2, GNOME Terminal, etc.)
 */
function setTerminalTitle(title: string): void {
  process.stdout.write(`\x1b]0;${title}\x07`);
}

interface AppProps {
  sessionId: string;
  initialConfigs?: BotConfig[];
  autoStart?: boolean;
}

type ViewMode = 'overview' | 'detail';
type InputMode = 'normal' | 'add-bot';

export function App({ sessionId, initialConfigs = DEFAULT_BOT_CONFIGS, autoStart = true }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  const terminalHeight = stdout?.rows || 24;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const [addBotIndex, setAddBotIndex] = useState(0);

  // Keep log buffer for file logging and internal events
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

  // Memory profiler - logs heap usage every 30s
  useMemoryProfiler({
    enabled: true,
    onLog: handleLog,
    getNextLogId: logActions.getNextId,
  });

  // Calculate grid dimensions for navigation
  const cardWidth = 38;
  const cardsPerRow = Math.max(1, Math.floor(terminalWidth / cardWidth));

  // File watcher for hot-reload
  const handleFileChange = useCallback((filename: string) => {
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
    enabled: true,
    onFileChange: handleFileChange,
  });

  // Manual restart trigger via `touch .restart`
  const handleRestartTrigger = useCallback(() => {
    handleLog({
      id: logActions.getNextId(),
      timestamp: new Date(),
      botName: 'Manager',
      level: 30,
      message: 'Restart triggered via .restart file',
      extras: {},
      raw: '',
    });
    botActions.restartAll();
  }, [handleLog, logActions, botActions]);

  useRestartTrigger({ onTrigger: handleRestartTrigger });

  // Signal handling for restart (SIGUSR1)
  useEffect(() => {
    const handleSignal = () => {
      handleLog({
        id: logActions.getNextId(),
        timestamp: new Date(),
        botName: 'Manager',
        level: 30,
        message: 'Received SIGUSR1, restarting all bots...',
        extras: {},
        raw: '',
      });
      botActions.restartAll();
    };

    process.on('SIGUSR1', handleSignal);

    return () => {
      process.off('SIGUSR1', handleSignal);
    };
  }, [handleLog, logActions, botActions]);

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

  // Update terminal title based on bot state
  useEffect(() => {
    const runningBots = bots.filter(b => b.status === 'running');
    const totalBots = bots.length;

    if (totalBots === 0) {
      setTerminalTitle('Minecraft Bots');
    } else if (runningBots.length === 0) {
      setTerminalTitle(`Minecraft Bots [0/${totalBots} running]`);
    } else {
      const names = runningBots.map(b => b.config.roleLabel).join(', ');
      setTerminalTitle(`Minecraft Bots [${runningBots.length}/${totalBots}] ${names}`);
    }

    // Reset title on unmount
    return () => {
      setTerminalTitle('');
    };
  }, [bots]);

  // All roles are always available (can have multiple of the same)
  const availableRoles = DEFAULT_BOT_CONFIGS;

  // Keyboard input handling
  useInput((input, key) => {
    // Handle role selector input mode
    if (inputMode === 'add-bot') {
      return;
    }

    // Back to overview from detail view
    if (viewMode === 'detail') {
      if (key.escape || key.backspace || key.delete) {
        setViewMode('overview');
        return;
      }
    }

    // Navigation
    if (viewMode === 'overview') {
      // Grid navigation
      if (input === 'j' || key.downArrow) {
        setSelectedIndex(i => Math.min(i + cardsPerRow, bots.length - 1));
      } else if (input === 'k' || key.upArrow) {
        setSelectedIndex(i => Math.max(i - cardsPerRow, 0));
      } else if (input === 'l' || key.rightArrow) {
        setSelectedIndex(i => Math.min(i + 1, bots.length - 1));
      } else if (input === 'h' && !key.ctrl || key.leftArrow) {
        // 'h' for left navigation, but not if ctrl+h (could be backspace on some terminals)
        if (input === 'h') {
          setSelectedIndex(i => Math.max(i - 1, 0));
        } else {
          setSelectedIndex(i => Math.max(i - 1, 0));
        }
      }
      // Enter detail view
      else if (key.return) {
        if (bots.length > 0) {
          setViewMode('detail');
        }
      }
    }

    // Bot actions (work in both views)
    if (input === 's') {
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
    } else if (input === 'a' && viewMode === 'overview') {
      setAddBotIndex(0);
      setInputMode('add-bot');
    } else if (input === 'd' && viewMode === 'overview') {
      const bot = bots[selectedIndex];
      if (bot) {
        botActions.deleteBot(bot.id);
        setSelectedIndex(i => Math.max(0, Math.min(i, bots.length - 2)));
      }
    }

    // Hot-reload toggle (use 'H' to avoid conflict with 'h' for left nav)
    else if (input === 'H') {
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

    // Quit
    else if (input === 'q') {
      botActions.stopAll().then(() => {
        exit();
      });
    }
  });

  // Handle add bot from role selector
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
    setTimeout(() => botActions.startBot(botId), 100);
  }, [botActions, handleLog, logActions]);

  const handleCancelAdd = useCallback(() => {
    setInputMode('normal');
  }, []);

  const handleAddBotNavigate = useCallback((delta: number) => {
    setAddBotIndex(i => Math.max(0, Math.min(i + delta, DEFAULT_BOT_CONFIGS.length - 1)));
  }, []);

  // Get selected bot for detail view
  const selectedBot = bots[selectedIndex];

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {viewMode === 'overview' ? (
        <OverviewScreen
          bots={bots}
          selectedIndex={selectedIndex}
          hotReloadEnabled={hotReloadEnabled}
          sessionId={sessionId}
        />
      ) : (
        selectedBot && (
          <DetailScreen
            bot={selectedBot}
            sessionId={sessionId}
          />
        )
      )}

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
