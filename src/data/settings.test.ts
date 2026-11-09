import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { DEFAULT_SCALE } from '@/domain/scaleBarcode';
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
  it('keeps the scale label format for every register, apart from the day cutoff', async () => {
    expect((await loadMarketSettings(db)).scale).toEqual(DEFAULT_SCALE);
    const scale = { enabled: true, prefixes: ['28'], codeDigits: 4, value: 'price' as const };
    await saveMarketSettings(db, { scale }, at);
    await saveMarketSettings(db, { cutoffMinutes: 120 }, new Date(at.getTime() + 60_000));
    expect(await loadMarketSettings(db)).toEqual({ cutoffMinutes: 120, scale });
    await expect(
      saveMarketSettings(db, { scale: { ...scale, prefixes: ['86'] } }, at),
    ).rejects.toThrow(RangeError);
    const ops = (await pendingOps(db)).filter((op) => op.table === 'settings');
    expect(ops.map((op) => op.kind)).toEqual(['insert', 'patch']);
  });

  it('keeps the day cutoff for the whole market', async () => {
    expect(await loadMarketSettings(db)).toMatchObject({ cutoffMinutes: 0 });
    await saveMarketSettings(db, { cutoffMinutes: 120 }, at);
    expect(await loadMarketSettings(db)).toMatchObject({ cutoffMinutes: 120 });
    await saveMarketSettings(db, { cutoffMinutes: 240 }, new Date(at.getTime() + 60_000));
    expect(await loadMarketSettings(db)).toMatchObject({ cutoffMinutes: 240 });
    await expect(saveMarketSettings(db, { cutoffMinutes: 721 }, at)).rejects.toThrow(RangeError);
    await expect(saveMarketSettings(db, { cutoffMinutes: 1.5 }, at)).rejects.toThrow(RangeError);
    // Synced: added once, changed after.
    expect(
      (await pendingOps(db)).filter((op) => op.table === 'settings').map((op) => op.kind),
    ).toEqual(['insert', 'patch']);
  });
});
