import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messageOf } from './api';

export const TONES = {
  ok: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export const CHIPS = {
  ok: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
} as const;

/**
 * Reads something, again whenever `key` changes and on `reload()`: the data, or why it could not
 * be read. The key names everything `load` reads (a market's id, a filter). A reload keeps the
 * last data on screen while the new one comes.
 */
export function useLoad<T>(
  load: () => Promise<T>,
  key: string,
): { data: T | undefined; error: string | undefined; reload(): void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const latest = useRef(load);
  useLayoutEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    let live = true;
    latest.current().then(
      (next) => {
        if (live) {
          setData(next);
          setError(undefined);
        }
      },
      (reason: unknown) => {
        if (live) {
          setError(messageOf(reason));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [key, version]);
  return { data, error, reload: () => setVersion((now) => now + 1) };
}
