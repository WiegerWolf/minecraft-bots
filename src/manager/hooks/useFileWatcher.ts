import { useState, useEffect, useRef, useCallback } from 'react';
import { watch, type FSWatcher } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = resolve(__dirname, '../..');

export interface UseFileWatcherOptions {
  enabled: boolean;
  debounceMs?: number;
  onFileChange?: (filename: string) => void;
}

export function useFileWatcher(options: UseFileWatcherOptions): [boolean, (enabled: boolean) => void] {
  const { enabled: initialEnabled, debounceMs = 100, onFileChange } = options;
  const [enabled, setEnabled] = useState(initialEnabled);
  const watcherRef = useRef<FSWatcher | null>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useCallback((newEnabled: boolean) => {
    setEnabled(newEnabled);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (watcherRef.current) {
        watcherRef.current.close();
        watcherRef.current = null;
      }
      return;
    }

    watcherRef.current = watch(SRC_DIR, { recursive: true }, (event, filename) => {
      if (!filename) return;

      // Only watch .ts, .js, .json files
      if (!filename.endsWith('.ts') && !filename.endsWith('.js') && !filename.endsWith('.json')) {
        return;
      }

      // Ignore village.json (shared state file)
      if (filename.includes('village.json')) return;

      // Debounce
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(() => {
        onFileChange?.(filename);
      }, debounceMs);
    });

    return () => {
      if (watcherRef.current) {
        watcherRef.current.close();
        watcherRef.current = null;
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [enabled, debounceMs, onFileChange]);

  return [enabled, toggle];
}
