import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { LogEntry } from '../types';

const MAX_LOG_ENTRIES = 1000;
const BATCH_INTERVAL_MS = 200; // Batch updates every 200ms

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

  // Batch pending logs to reduce render frequency
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLogs = useCallback(() => {
    if (pendingLogsRef.current.length === 0) return;

    const pending = pendingLogsRef.current;
    pendingLogsRef.current = [];
    batchTimeoutRef.current = null;

    setLogs(prev => {
      const newLogs = [...prev, ...pending];
      if (newLogs.length > maxEntries) {
        return newLogs.slice(-maxEntries);
      }
      return newLogs;
    });
  }, [maxEntries]);

  const addLog = useCallback((entry: LogEntry) => {
    pendingLogsRef.current.push(entry);

    // Schedule flush if not already scheduled
    if (!batchTimeoutRef.current) {
      batchTimeoutRef.current = setTimeout(flushLogs, BATCH_INTERVAL_MS);
    }
  }, [flushLogs]);

  const clear = useCallback(() => {
    pendingLogsRef.current = [];
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
      batchTimeoutRef.current = null;
    }
    setLogs([]);
  }, []);

  const getNextId = useCallback(() => {
    return nextIdRef.current++;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, []);

  const actions = useMemo(() => ({ addLog, clear, getNextId }), [addLog, clear, getNextId]);
  return [logs, actions];
}
