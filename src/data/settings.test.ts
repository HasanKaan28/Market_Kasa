import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { DEFAULT_SCALE } from '@/domain/scaleBarcode';
import { loadMarketSettings, saveMarketSettings, type MarketSettings } from './settings';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('market settings', () => {
  it('asks no PIN unless the market turns it on', async () => {
    expect(await loadMarketSettings(db)).toMatchObject({ requirePin: false });
    // A market saved before the setting existed has no field: still no PIN.
    await saveMarketSettings(db, { cutoffMinutes: 60 }, at);
    expect(await loadMarketSettings(db)).toMatchObject({ requirePin: false });
    await saveMarketSettings(db, { requirePin: true }, at);
    expect(await loadMarketSettings(db)).toMatchObject({ requirePin: true, cutoffMinutes: 60 });
    expect(await db.settings.get('market')).toMatchObject({ requirePin: true });
    await saveMarketSettings(db, { requirePin: false }, at);
    expect(await loadMarketSettings(db)).toMatchObject({ requirePin: false });
    const odd = { requirePin: 'yes' } as unknown as Partial<MarketSettings>;
    await expect(saveMarketSettings(db, odd, at)).rejects.toThrow(RangeError);
  });

  it('never locks an idle owner unless the market says so', async () => {
    expect(await loadMarketSettings(db)).toMatchObject({ idleLockMinutes: 0 });
    for (const minutes of [3, 10, 30, 0] as const) {
      await saveMarketSettings(db, { idleLockMinutes: minutes }, at);
      expect(await loadMarketSettings(db)).toMatchObject({ idleLockMinutes: minutes });
    }
    // As a newer register or a bad row might send it.
    const odd = { idleLockMinutes: 5 } as unknown as Partial<MarketSettings>;
    await expect(saveMarketSettings(db, odd, at)).rejects.toThrow(RangeError);
  });

  it('gives a new customer ₺500 of credit unless the market says otherwise', async () => {
    expect(await loadMarketSettings(db)).toMatchObject({ newCustomerLimit: 50000 });
    await saveMarketSettings(db, { newCustomerLimit: 20000 }, at);
    expect(await loadMarketSettings(db)).toMatchObject({ newCustomerLimit: 20000 });
    await expect(saveMarketSettings(db, { newCustomerLimit: 0 }, at)).rejects.toThrow(RangeError);
    await expect(saveMarketSettings(db, { newCustomerLimit: 1.5 }, at)).rejects.toThrow(RangeError);
  });

  it('keeps the scale label format for every register, apart from the day cutoff', async () => {
    expect((await loadMarketSettings(db)).scale).toEqual(DEFAULT_SCALE);
    const scale = { enabled: true, prefixes: ['28'], codeDigits: 4, value: 'price' as const };
    await saveMarketSettings(db, { scale }, at);
    await saveMarketSettings(db, { cutoffMinutes: 120 }, new Date(at.getTime() + 60_000));
    expect(await loadMarketSettings(db)).toEqual({
      cutoffMinutes: 120,
      scale,
      newCustomerLimit: 50000,
      idleLockMinutes: 0,
      requirePin: false,
    });
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
