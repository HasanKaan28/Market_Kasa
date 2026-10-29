import { useLiveQuery } from 'dexie-react-hooks';
import { useContext } from 'react';
import type { MarketDb } from '@/data/db';
import { licenseState, type LicenseState } from '@/domain/license';
import { DataContext } from './appData';

const KEY = 'license';

/** The last day the market's licence covers, as last heard from the server (M0b); null if never. */
export async function loadLicense(db: MarketDb): Promise<string | null> {
  const value = (await db.meta.get(KEY))?.value;
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { expiresAt } = value as Record<string, unknown>;
  return typeof expiresAt === 'string' ? expiresAt : null;
}

export async function saveLicense(db: MarketDb, expiresAt: string): Promise<void> {
  await db.meta.put({ key: KEY, value: { expiresAt } });
}

const UNKNOWN: LicenseState = { kind: 'unknown' };

/**
 * Where the licence stands today. Outside the app's data, as when the shell is shown on its own,
 * nothing is known, and nothing is restricted.
 */
export function useLicense(): LicenseState {
  const data = useContext(DataContext);
  const expiresAt = useLiveQuery(async () => (data ? loadLicense(data.db) : null), [data]);
  return expiresAt === undefined ? UNKNOWN : licenseState(expiresAt, new Date());
}
