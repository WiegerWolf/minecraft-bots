import { useEffect, useRef } from 'react';
import { heapStats, memoryUsage, gcAndSweep } from 'bun:jsc';
import { appendFileSync } from 'fs';
import type { LogEntry } from '../types';

const PROFILE_INTERVAL = 30_000; // 30 seconds
const PROFILE_LOG_FILE = 'logs/heap-profile.log';

interface Snapshot {
  timestamp: number;
  heapSize: number;
  objectCount: number;
  objectTypeCounts: Record<string, number>;
  memUsage: {
    current: number;
    peak: number;
  };
}

export interface UseMemoryProfilerOptions {
  enabled?: boolean;
  onLog: (entry: LogEntry) => void;
  getNextLogId: () => number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function useMemoryProfiler(options: UseMemoryProfilerOptions) {
  const { enabled = true, onLog, getNextLogId } = options;
  const baselineRef = useRef<Snapshot | null>(null);
  const prevRef = useRef<Snapshot | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const takeSnapshot = (): Snapshot => {
      // Force GC before measuring to get accurate picture
      gcAndSweep();
      const stats = heapStats();
      const mem = memoryUsage();
      return {
        timestamp: Date.now(),
        heapSize: stats.heapSize,
        objectCount: stats.objectCount,
        objectTypeCounts: stats.objectTypeCounts as Record<string, number>,
        memUsage: {
          current: mem.current,
          peak: mem.peak,
        },
      };
    };

    const analyzeAndLog = () => {
      const current = takeSnapshot();
      const elapsed = Math.round((current.timestamp - startTimeRef.current) / 1000);

      const logToFile = (msg: string, data?: object) => {
        const line = JSON.stringify({ time: new Date().toISOString(), msg, ...data }) + '\n';
        try {
          appendFileSync(PROFILE_LOG_FILE, line);
        } catch { /* ignore */ }
      };

      // Set baseline on first run
      if (!baselineRef.current) {
        baselineRef.current = current;
        prevRef.current = current;
        const msg = `[baseline] heap: ${formatBytes(current.heapSize)} | objects: ${current.objectCount} | mem: ${formatBytes(current.memUsage.current)}`;
        logToFile(msg, { snapshot: current });
        onLog({
          id: getNextLogId(),
          timestamp: new Date(),
          botName: 'HeapProfile',
          level: 30,
          message: msg,
          extras: {},
          raw: '',
        });
        return;
      }

      const baseline = baselineRef.current;
      const prev = prevRef.current!;

      // Calculate deltas from baseline
      const heapDelta = current.heapSize - baseline.heapSize;
      const objDelta = current.objectCount - baseline.objectCount;
      const memDelta = current.memUsage.current - baseline.memUsage.current;

      // Find top growing object types (compared to baseline)
      const typeGrowth: { type: string; delta: number; current: number }[] = [];
      for (const [type, count] of Object.entries(current.objectTypeCounts)) {
        const baselineCount = baseline.objectTypeCounts[type] || 0;
        const delta = count - baselineCount;
        if (delta > 0) {
          typeGrowth.push({ type, delta, current: count });
        }
      }
      typeGrowth.sort((a, b) => b.delta - a.delta);

      // Find types that grew since last snapshot
      const recentGrowth: { type: string; delta: number }[] = [];
      for (const [type, count] of Object.entries(current.objectTypeCounts)) {
        const prevCount = prev.objectTypeCounts[type] || 0;
        const delta = count - prevCount;
        if (delta > 5) { // Only show significant growth
          recentGrowth.push({ type, delta });
        }
      }
      recentGrowth.sort((a, b) => b.delta - a.delta);

      // Main stats line
      const heapSign = heapDelta >= 0 ? '+' : '';
      const objSign = objDelta >= 0 ? '+' : '';
      const memSign = memDelta >= 0 ? '+' : '';

      const mainMsg = `[${elapsed}s] heap: ${formatBytes(current.heapSize)} (${heapSign}${formatBytes(heapDelta)}) | obj: ${current.objectCount} (${objSign}${objDelta}) | mem: ${formatBytes(current.memUsage.current)} (${memSign}${formatBytes(memDelta)})`;
      logToFile(mainMsg, {
        elapsed,
        heapSize: current.heapSize,
        heapDelta,
        objectCount: current.objectCount,
        objDelta,
        memCurrent: current.memUsage.current,
        memDelta,
        typeGrowth: typeGrowth.slice(0, 10),
        recentGrowth: recentGrowth.slice(0, 10),
      });

      onLog({
        id: getNextLogId(),
        timestamp: new Date(),
        botName: 'HeapProfile',
        level: 30,
        message: mainMsg,
        extras: {},
        raw: '',
      });

      // Log top growers from baseline if significant
      if (typeGrowth.length > 0 && typeGrowth[0]!.delta > 10) {
        const top5 = typeGrowth.slice(0, 5)
          .map(g => `${g.type}:+${g.delta}`)
          .join(', ');
        onLog({
          id: getNextLogId(),
          timestamp: new Date(),
          botName: 'HeapProfile',
          level: 20, // DEBUG
          message: `  growing since start: ${top5}`,
          extras: { typeGrowth: typeGrowth.slice(0, 10) },
          raw: '',
        });
      }

      // Log recent growth if any
      if (recentGrowth.length > 0) {
        const recent = recentGrowth.slice(0, 5)
          .map(g => `${g.type}:+${g.delta}`)
          .join(', ');
        onLog({
          id: getNextLogId(),
          timestamp: new Date(),
          botName: 'HeapProfile',
          level: 20, // DEBUG
          message: `  grew last 30s: ${recent}`,
          extras: { recentGrowth },
          raw: '',
        });
      }

      prevRef.current = current;
    };

    // Log immediately on start
    analyzeAndLog();

    const interval = setInterval(analyzeAndLog, PROFILE_INTERVAL);

    return () => {
      clearInterval(interval);
    };
  }, [enabled, onLog, getNextLogId]);
}
