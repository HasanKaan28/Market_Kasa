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
};

const DEFAULT_INTERVAL_MS = 60_000;

/** Runs at most one sync at a time and reports every status change to its subscribers. */
export function createSyncRunner({ db, transport, isOnline, now }: SyncRunnerDeps): SyncRunner {
  let current: SyncStatus = { state: 'pending', pendingCount: 0 };
  let inFlight: Promise<SyncStatus> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<(status: SyncStatus) => void>();

  const publish = (next: SyncStatus): SyncStatus => {
    current = next;
    for (const listener of listeners) {
      listener(next);
    }
    return next;
  };

  // Callers fire and forget, so a round reports every failure as a status and never rejects.
  const syncRound = async (): Promise<SyncStatus> => {
    const { lastSyncedAt } = current;
    try {
      if (!isOnline()) {
        return publish({ state: 'offline', pendingCount: await pendingCount(db), lastSyncedAt });
      }
      await syncOnce(db, transport);
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
