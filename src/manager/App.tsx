import React, { useState, useCallback, useEffect } from 'react';
import { Box, useInput, useApp, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Header } from './components/Header';
import { BotList } from './components/BotList';
import { LogPanel } from './components/LogPanel';
import { HelpBar } from './components/HelpBar';
import { useBotManager } from './hooks/useBotManager';
import { useLogBuffer } from './hooks/useLogBuffer';
import { useFileWatcher } from './hooks/useFileWatcher';
import type { BotConfig, LogEntry } from './types';
import { DEFAULT_BOT_CONFIGS, BOT_SPAWN_DELAY } from './types';

interface AppProps {
  sessionId: string;
  initialConfigs?: BotConfig[];
  autoStart?: boolean;
}

type InputMode = 'normal' | 'add-bot';

export function App({ sessionId, initialConfigs = DEFAULT_BOT_CONFIGS, autoStart = true }: AppProps) {
  const { exit } = useApp();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterBotLabel, setFilterBotLabel] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const [newBotRole, setNewBotRole] = useState('');

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

  // File watcher for hot-reload
  const handleFileChange = useCallback((filename: string) => {
    // Add a log entry for the file change
    handleLog({
      id: logActions.getNextId(),
      timestamp: new Date(),
      botLabel: 'Manager',
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

  // Keyboard input handling
  useInput((input, key) => {
    if (inputMode === 'add-bot') {
      if (key.escape) {
        setInputMode('normal');
        setNewBotRole('');
      }
      return;
    }

    // Navigation
    if (input === 'j' || key.downArrow) {
      setSelectedIndex(i => Math.min(i + 1, bots.length - 1));
    } else if (input === 'k' || key.upArrow) {
      setSelectedIndex(i => Math.max(i - 1, 0));
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
      setInputMode('add-bot');
    } else if (input === 'd') {
      const bot = bots[selectedIndex];
      if (bot) {
        botActions.deleteBot(bot.id);
        setSelectedIndex(i => Math.max(0, Math.min(i, bots.length - 2)));
      }
    }

    // Hot-reload toggle
    else if (input === 'h') {
      setHotReload(!hotReloadEnabled);
      handleLog({
        id: logActions.getNextId(),
        timestamp: new Date(),
        botLabel: 'Manager',
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
      if (filterBotLabel) {
        setFilterBotLabel(null);
      } else {
        const bot = bots[selectedIndex];
        if (bot) setFilterBotLabel(bot.config.roleLabel);
      }
    }

    // Quit
    else if (input === 'q') {
      botActions.stopAll().then(() => {
        exit();
      });
    }
  });

  // Handle add bot submission
  const handleAddBotSubmit = (value: string) => {
    if (value.trim()) {
      const roleLabel = value.trim();
      const role = roleLabel.toLowerCase().replace(/\s+/g, '-');
      const config: BotConfig = {
        role,
        roleLabel,
        aliases: [role, roleLabel.toLowerCase()],
      };
      botActions.addBot(config);
      handleLog({
        id: logActions.getNextId(),
        timestamp: new Date(),
        botLabel: 'Manager',
        level: 30,
        message: `Added bot: ${roleLabel} (session-only)`,
        extras: {},
        raw: '',
      });
    }
    setInputMode('normal');
    setNewBotRole('');
  };

  return (
    <Box flexDirection="column" height="100%">
      <Header sessionId={sessionId} hotReloadEnabled={hotReloadEnabled} />

      <Box flexGrow={1}>
        <BotList bots={bots} selectedIndex={selectedIndex} />
        <LogPanel logs={logs} filterBotLabel={filterBotLabel} />
      </Box>

      {inputMode === 'add-bot' ? (
        <Box paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
          <Text>New bot role: </Text>
          <TextInput
            value={newBotRole}
            onChange={setNewBotRole}
            onSubmit={handleAddBotSubmit}
          />
          <Text dimColor> (Enter to confirm, Esc to cancel)</Text>
        </Box>
      ) : (
        <HelpBar logFilterActive={filterBotLabel !== null} />
      )}
    </Box>
  );
}
