import type { MarketDb } from '@/data/db';
import { pendingCount } from '@/data/outbox';
import { syncOnce } from './engine';
import type { SyncTransport } from './protocol';

export type SyncState = 'online' | 'offline' | 'pending' | 'error';

export type SyncStatus = {
  state: SyncState;
  pendingCount: number;
  lastSyncedAt?: string;
  error?: string;
};

export type SyncRunner = {
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  run(): Promise<SyncStatus>;
  start(intervalMs?: number): void;
  stop(): void;
};

type SyncRunnerDeps = {
  db: MarketDb;
  transport: SyncTransport;
  isOnline: () => boolean;
  now: () => Date;
  /** How long one request may take before the round is given up as an error. */
  requestTimeoutMs?: number;
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Runs at most one sync at a time and reports every status change to its subscribers. */
export function createSyncRunner({
  db,
  transport,
  isOnline,
  now,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: SyncRunnerDeps): SyncRunner {
  let current: SyncStatus = { state: isOnline() ? 'pending' : 'offline', pendingCount: 0 };
  let inFlight: Promise<SyncStatus> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<(status: SyncStatus) => void>();
  const timed = withTimeout(transport, requestTimeoutMs);

  const publish = (next: SyncStatus): SyncStatus => {
    current = next;
    for (const listener of listeners) {
      // One broken listener must not stop the others, or the round that called them.
      try {
        listener(next);
      } catch (error) {
        console.error('Eşitleme durumu dinleyicisi hata verdi', error);
      }
    }
    return next;
  };

  // The queue is shown as it is before the first round, not as "0 işlem bekliyor".
  void pendingCount(db).then(
    (count) => {
      if (current.lastSyncedAt === undefined && !inFlight) {
        publish({ ...current, pendingCount: count });
      }
    },
    () => undefined,
  );

  // Callers fire and forget, so a round reports every failure as a status and never rejects.
  const syncRound = async (): Promise<SyncStatus> => {
    const { lastSyncedAt } = current;
    try {
      if (!isOnline()) {
        return publish({ state: 'offline', pendingCount: await pendingCount(db), lastSyncedAt });
      }
      await syncOnce(db, timed);
      const pending = await pendingCount(db);
      return publish({
        state: pending > 0 ? 'pending' : 'online',
        pendingCount: pending,
        lastSyncedAt: now().toISOString(),
      });
    } catch (error) {
      return publish({
        state: 'error',
        pendingCount: await pendingCount(db).catch(() => current.pendingCount),
        lastSyncedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const run = (): Promise<SyncStatus> => {
    inFlight ??= syncRound().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  return {
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run,
    start(intervalMs = DEFAULT_INTERVAL_MS) {
      if (timer === undefined) {
        timer = setInterval(() => void run(), intervalMs);
      }
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

/** The same transport, where a request that outlives `ms` fails instead of holding the round. */
function withTimeout(transport: SyncTransport, ms: number): SyncTransport {
  const race = <T>(request: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Sunucu ${Math.round(ms / 1000)} saniyede yanıt vermedi`)),
        ms,
      );
      request.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  return {
    push: (request) => race(transport.push(request)),
    pull: (request) => race(transport.pull(request)),
  };
}
