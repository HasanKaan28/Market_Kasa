import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { loadMarketSettings, saveMarketSettings } from './settings';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('market settings', () => {
  it('keeps the day cutoff for the whole market', async () => {
    expect(await loadMarketSettings(db)).toEqual({ cutoffMinutes: 0 });
    await saveMarketSettings(db, { cutoffMinutes: 120 }, at);
    expect(await loadMarketSettings(db)).toEqual({ cutoffMinutes: 120 });
    await saveMarketSettings(db, { cutoffMinutes: 240 }, new Date(at.getTime() + 60_000));
    expect(await loadMarketSettings(db)).toEqual({ cutoffMinutes: 240 });
    await expect(saveMarketSettings(db, { cutoffMinutes: 721 }, at)).rejects.toThrow(RangeError);
    await expect(saveMarketSettings(db, { cutoffMinutes: 1.5 }, at)).rejects.toThrow(RangeError);
    // Synced: added once, changed after.
    expect(
      (await pendingOps(db))
        .filter((op) => op.table === 'settings')
        .map((op) => op.kind),
    ).toEqual(['insert', 'patch']);
  });
});
