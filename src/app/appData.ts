import { createContext, useContext, useSyncExternalStore } from 'react';
import { openMarketDb, type MarketDb } from '@/data/db';
import type { SyncTransport } from '@/sync/protocol';
import { createSyncRunner, type SyncRunner, type SyncStatus } from '@/sync/runner';
import type { DeviceSettings } from './device';

/** Everything the screens need: this market's database, the device settings and the sync runner. */
export type AppData = { db: MarketDb; settings: DeviceSettings; runner: SyncRunner };

type AppDataDeps = {
  transport?: SyncTransport;
  isOnline?: () => boolean;
  now?: () => Date;
};

// Until the server exists (M0b) every request fails and the device reports itself offline.
const NO_SERVER: SyncTransport = {
  push: () => Promise.reject(new Error('Sunucu bağlantısı henüz kurulmadı')),
  pull: () => Promise.reject(new Error('Sunucu bağlantısı henüz kurulmadı')),
};

export function createAppData(settings: DeviceSettings, deps: AppDataDeps = {}): AppData {
  const db = openMarketDb(settings.marketId);
  const runner = createSyncRunner({
    db,
    transport: deps.transport ?? NO_SERVER,
    isOnline: deps.isOnline ?? (() => false),
    now: deps.now ?? (() => new Date()),
  });
  return { db, settings, runner };
}

export const DataContext = createContext<AppData | null>(null);

export function useData(): AppData {
  const data = useContext(DataContext);
  if (!data) {
    throw new Error('useData needs a DataProvider');
  }
  return data;
}

export function useSyncStatus(runner: SyncRunner): SyncStatus {
  return useSyncExternalStore(runner.subscribe, runner.status);
}
