import { useEffect, useRef } from 'react';
import { watch, existsSync, unlinkSync, type FSWatcher } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../..');
const TRIGGER_FILE = resolve(PROJECT_ROOT, '.restart');

export interface UseRestartTriggerOptions {
  onTrigger: () => void;
}

/**
 * Watch for a `.restart` file in the project root.
 * When the file is created or modified, trigger a restart and delete the file.
 *
 * Usage: `touch .restart` to restart all bots
 */
export function useRestartTrigger(options: UseRestartTriggerOptions): void {
  const { onTrigger } = options;
  const watcherRef = useRef<FSWatcher | null>(null);
  const lastTriggerRef = useRef<number>(0);

  useEffect(() => {
    // Watch the project root for the trigger file
    watcherRef.current = watch(PROJECT_ROOT, (event, filename) => {
      if (filename !== '.restart') return;

      // Debounce - ignore triggers within 1 second
      const now = Date.now();
      if (now - lastTriggerRef.current < 1000) return;
      lastTriggerRef.current = now;

      // Check if file exists
      if (!existsSync(TRIGGER_FILE)) return;

      // Delete the trigger file
      try {
        unlinkSync(TRIGGER_FILE);
      } catch {
        // Ignore deletion errors
      }

      // Trigger restart
      onTrigger();
    });

    // Also check on startup if trigger file exists
    if (existsSync(TRIGGER_FILE)) {
      try {
        unlinkSync(TRIGGER_FILE);
      } catch {
        // Ignore
      }
      // Small delay to let the app initialize
      setTimeout(onTrigger, 500);
    }

    return () => {
      if (watcherRef.current) {
        watcherRef.current.close();
        watcherRef.current = null;
      }
    };
  }, [onTrigger]);
}
