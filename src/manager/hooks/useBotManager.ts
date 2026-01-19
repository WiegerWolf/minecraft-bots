import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  deleteBot: (botId: string) => Promise<void>;
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
  const cleanupFunctionsRef = useRef<Map<string, () => void>>(new Map());
  const nextBotIdRef = useRef(initialConfigs.length);
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const botsRef = useRef<ManagedBot[]>(bots);
  botsRef.current = bots; // Keep ref in sync with state

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
    const bot = botsRef.current.find(b => b.id === botId);
    if (!bot || bot.status === 'running' || bot.status === 'starting') return;

    // Clear any pending retry
    const existingTimeout = retryTimeoutsRef.current.get(botId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeoutsRef.current.delete(botId);
    }

    const botName = generateBotName(bot.config.roleLabel);
    updateBot(botId, { status: 'starting', name: botName });

    const { process, cleanup } = spawnBot({
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

        // Clean up readers to prevent memory leaks
        const cleanupFn = cleanupFunctionsRef.current.get(botId);
        if (cleanupFn) {
          cleanupFn();
          cleanupFunctionsRef.current.delete(botId);
        }

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
    cleanupFunctionsRef.current.set(botId, cleanup);
    updateBot(botId, { process });
  }, [sessionId, onLog, getNextLogId, updateBot]);

  // Stop a specific bot
  const stopBot = useCallback(async (botId: string) => {
    // Clear any pending retry
    const existingTimeout = retryTimeoutsRef.current.get(botId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeoutsRef.current.delete(botId);
    }

    // Clean up readers first to prevent memory leaks
    const cleanupFn = cleanupFunctionsRef.current.get(botId);
    if (cleanupFn) {
      cleanupFn();
      cleanupFunctionsRef.current.delete(botId);
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
    const currentBots = botsRef.current;
    // Stop all bots first
    for (const bot of currentBots) {
      await stopBot(bot.id);
    }

    // Start all bots with delay between them
    for (let i = 0; i < currentBots.length; i++) {
      await startBot(currentBots[i]!.id);
      if (i < currentBots.length - 1) {
        await new Promise(resolve => setTimeout(resolve, BOT_SPAWN_DELAY));
      }
    }
  }, [stopBot, startBot]);

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
  const deleteBot = useCallback(async (botId: string) => {
    await stopBot(botId);
    // Clean up refs that stopBot doesn't clear for deleted bots
    reconnectAttemptsRef.current.delete(botId);
    setBots(prev => prev.filter(b => b.id !== botId));
  }, [stopBot]);

  // Stop all bots
  const stopAll = useCallback(async () => {
    for (const bot of botsRef.current) {
      await stopBot(bot.id);
    }
  }, [stopBot]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timeout of retryTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      // Clean up all readers to prevent memory leaks
      for (const cleanup of cleanupFunctionsRef.current.values()) {
        cleanup();
      }
      cleanupFunctionsRef.current.clear();
      for (const process of processesRef.current.values()) {
        process.kill();
      }
    };
  }, []);

  const actions = useMemo(() => ({
    startBot,
    stopBot,
    restartBot,
    restartAll,
    addBot,
    deleteBot,
    stopAll,
  }), [startBot, stopBot, restartBot, restartAll, addBot, deleteBot, stopAll]);

  return [bots, actions];
}
