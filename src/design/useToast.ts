import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 4000;

/** One short message at a time; a new message replaces the old one and restarts the timer. */
export function useToast(durationMs: number = DEFAULT_DURATION_MS): {
  message: string | null;
  show(message: string): void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(
    (next: string) => {
      clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  useEffect(() => {
    const pending = timer;
    return () => clearTimeout(pending.current);
  }, []);

  return { message, show };
}
