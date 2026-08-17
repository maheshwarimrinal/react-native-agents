// Correct hook: derived values computed during render, cleanup on every
// subscription, functional updates, no state mirroring. Nothing to report.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type Options = { intervalMs?: number; enabled?: boolean };

export function useElapsedSession(startedAt: Date, { intervalMs = 1000, enabled = true }: Options = {}) {
  const [now, setNow] = useState(() => Date.now());
  const [events, setEvents] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  // Recompute immediately when the app returns to the foreground; a background
  // interval is throttled, so the displayed value would otherwise be stale.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') setNow(Date.now());
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const append = useCallback((event: string) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  useEffect(() => {
    const sub = sessionEvents.subscribe(append);
    return () => sub.remove();
  }, [append]);

  // Derived during render — no state to mirror, no effect to keep in sync.
  const elapsedMs = Math.max(0, now - startedAt.getTime());
  const label = useMemo(() => formatDuration(elapsedMs), [elapsedMs]);

  return { elapsedMs, label, events, append };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

declare const sessionEvents: {
  subscribe(cb: (e: string) => void): { remove(): void };
};
