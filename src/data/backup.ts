import type { MarketDb } from './db';

/** Marks a file as a Market Kasa backup, so a restore can refuse anything else. */
export const BACKUP_FORMAT = 'market-kasa-backup';

/**
 * Everything this register holds for its market, at one moment: every table as it is stored,
 * the changes not yet sent to the server included. Each register keeps the whole market, so a
 * backup from any of them is the whole market as that register last saw it.
 */
export type MarketBackup = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  marketId: string;
  marketName: string;
  appVersion: string;
  exportedAt: string;
  tables: Record<string, unknown[]>;
};

/** Reads every table in one read-only transaction, so the copy is of a single moment. */
export async function marketBackup(
  db: MarketDb,
  about: { marketId: string; marketName: string; appVersion: string; now: Date },
): Promise<MarketBackup> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) {
      tables[table.name] = await table.toArray();
    }
  });
  return {
    format: BACKUP_FORMAT,
    version: 1,
    marketId: about.marketId,
    marketName: about.marketName,
    appVersion: about.appVersion,
    exportedAt: about.now.toISOString(),
    tables,
  };
}

const istanbulDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' });

/** `market-kasa-yedek-<market>-<YYYY-MM-DD>.json`, the day as it is in Istanbul. */
export function backupFileName(marketId: string, at: Date): string {
  return `market-kasa-yedek-${marketId}-${istanbulDay.format(at)}.json`;
}
