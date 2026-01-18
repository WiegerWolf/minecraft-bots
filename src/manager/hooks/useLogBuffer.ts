import { useState, useCallback, useRef, useMemo } from 'react';
import type { LogEntry } from '../types';

const MAX_LOG_ENTRIES = 1000;

export interface UseLogBufferOptions {
  maxEntries?: number;
}

export interface LogBufferActions {
  addLog: (entry: LogEntry) => void;
  clear: () => void;
  getNextId: () => number;
}

export function useLogBuffer(options: UseLogBufferOptions = {}): [LogEntry[], LogBufferActions] {
  const { maxEntries = MAX_LOG_ENTRIES } = options;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const nextIdRef = useRef(0);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs(prev => {
      const newLogs = [...prev, entry];
      if (newLogs.length > maxEntries) {
        return newLogs.slice(-maxEntries);
      }
      return newLogs;
    });
  }, [maxEntries]);

  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  const getNextId = useCallback(() => {
    return nextIdRef.current++;
  }, []);

  return [logs, { addLog, clear, getNextId }];
}

export function filterLogs(logs: LogEntry[], botLabel: string | null): LogEntry[] {
  if (!botLabel) return logs;
  return logs.filter(log => log.botLabel === botLabel);
}
