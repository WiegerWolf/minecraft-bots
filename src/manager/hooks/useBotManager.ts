import { useState, useCallback, useRef, useEffect } from 'react';
import type { Subprocess } from 'bun';
import type { ManagedBot, BotConfig, LogEntry } from '../types';
import { DEFAULT_BOT_CONFIGS, MAX_BACKOFF, INITIAL_BACKOFF, BOT_SPAWN_DELAY } from '../types';
import { generateBotName, spawnBot } from '../botProcess';

export interface UseBotManagerOptions {
  sessionId: string;
  initialConfigs?: BotConfig[];
  onLog: (entry: LogEntry) => void;
  getNextLogId: () => number;
}

export interface BotManagerActions {
  startBot: (botId: string) => Promise<void>;
  stopBot: (botId: string) => Promise<void>;
  restartBot: (botId: string) => Promise<void>;
  restartAll: () => Promise<void>;
  addBot: (config: BotConfig) => string;
  deleteBot: (botId: string) => void;
  stopAll: () => Promise<void>;
}

export function useBotManager(options: UseBotManagerOptions): [ManagedBot[], BotManagerActions] {
  const { sessionId, initialConfigs = DEFAULT_BOT_CONFIGS, onLog, getNextLogId } = options;

  const [bots, setBots] = useState<ManagedBot[]>(() =>
    initialConfigs.map((config, i) => ({
      id: `bot-${i}`,
      config,
      status: 'stopped',
      process: null,
      name: '',
      reconnectAttempts: 0,
    }))
  );

  const retryTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const processesRef = useRef<Map<string, Subprocess>>(new Map());
  const nextBotIdRef = useRef(initialConfigs.length);
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());

  // Update bot state helper
  const updateBot = useCallback((botId: string, updates: Partial<ManagedBot>) => {
    setBots(prev => prev.map(bot =>
      bot.id === botId ? { ...bot, ...updates } : bot
    ));
  }, []);

  // Get bot by ID
  const getBot = useCallback((botId: string): ManagedBot | undefined => {
    return bots.find(b => b.id === botId);
  }, [bots]);

  // Start a specific bot
  const startBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.status === 'running' || bot.status === 'starting') return;

    // Clear any pending retry
    const existingTimeout = retryTimeoutsRef.current.get(botId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeoutsRef.current.delete(botId);
    }

    const botName = generateBotName(bot.config.roleLabel);
    updateBot(botId, { status: 'starting', name: botName });

    const process = spawnBot({
      config: bot.config,
      sessionId,
      botName,
      onLog,
      getNextLogId,
      onSpawnSuccess: () => {
        reconnectAttemptsRef.current.set(botId, 0);
        updateBot(botId, { status: 'running', reconnectAttempts: 0 });
      },
      onExit: (exitCode: number) => {
        // Check if this is still the current process
        if (processesRef.current.get(botId) !== process) return;

        processesRef.current.delete(botId);

        if (exitCode !== 0 && exitCode !== null) {
          updateBot(botId, { status: 'crashed', process: null });

          // Get current attempts from ref to avoid stale closure
          const attempts = reconnectAttemptsRef.current.get(botId) || 0;
          const delay = Math.min(INITIAL_BACKOFF * Math.pow(2, attempts), MAX_BACKOFF);

          reconnectAttemptsRef.current.set(botId, attempts + 1);
          updateBot(botId, { reconnectAttempts: attempts + 1 });

          const timeout = setTimeout(() => {
            retryTimeoutsRef.current.delete(botId);
            updateBot(botId, { status: 'restarting' });
            startBot(botId);
          }, delay);
          retryTimeoutsRef.current.set(botId, timeout);
        } else {
          updateBot(botId, { status: 'stopped', process: null });
        }
      },
    });

    processesRef.current.set(botId, process);
    updateBot(botId, { process });
  }, [bots, sessionId, onLog, getNextLogId, updateBot]);

  // Stop a specific bot
  const stopBot = useCallback(async (botId: string) => {
    // Clear any pending retry
    const existingTimeout = retryTimeoutsRef.current.get(botId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeoutsRef.current.delete(botId);
    }

    const process = processesRef.current.get(botId);
    if (process) {
      process.kill();
      await process.exited;
      processesRef.current.delete(botId);
    }

    reconnectAttemptsRef.current.set(botId, 0);
    updateBot(botId, { status: 'stopped', process: null, reconnectAttempts: 0 });
  }, [updateBot]);

  // Restart a specific bot
  const restartBot = useCallback(async (botId: string) => {
    await stopBot(botId);
    await startBot(botId);
  }, [stopBot, startBot]);

  // Restart all bots
  const restartAll = useCallback(async () => {
    // Stop all bots first
    for (const bot of bots) {
      await stopBot(bot.id);
    }

    // Start all bots with delay between them
    for (let i = 0; i < bots.length; i++) {
      await startBot(bots[i]!.id);
      if (i < bots.length - 1) {
        await new Promise(resolve => setTimeout(resolve, BOT_SPAWN_DELAY));
      }
    }
  }, [bots, stopBot, startBot]);

  // Add a new bot (session-only)
  const addBot = useCallback((config: BotConfig): string => {
    const id = `bot-${nextBotIdRef.current++}`;
    setBots(prev => [...prev, {
      id,
      config,
      status: 'stopped',
      process: null,
      name: '',
      reconnectAttempts: 0,
    }]);
    return id;
  }, []);

  // Delete a bot
  const deleteBot = useCallback((botId: string) => {
    stopBot(botId);
    setBots(prev => prev.filter(b => b.id !== botId));
  }, [stopBot]);

  // Stop all bots
  const stopAll = useCallback(async () => {
    for (const bot of bots) {
      await stopBot(bot.id);
    }
  }, [bots, stopBot]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timeout of retryTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      for (const process of processesRef.current.values()) {
        process.kill();
      }
    };
  }, []);

  return [bots, {
    startBot,
    stopBot,
    restartBot,
    restartAll,
    addBot,
    deleteBot,
    stopAll,
  }];
}
