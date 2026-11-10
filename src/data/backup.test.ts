import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { BACKUP_FORMAT, backupFileName, marketBackup } from './backup';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { createProduct } from './products';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-09T18:30:00Z');

describe('marketBackup', () => {
  it('holds every table of the market, the unsent changes too', async () => {
    const milk = await createProduct(
      db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      at,
    );
    const unsent = (await pendingOps(db)).length;
    expect(unsent).toBeGreaterThan(0);

    const backup = await marketBackup(db, {
      marketId: 'kursunlu-ab12cd',
      marketName: 'Kurşunlu Market',
      appVersion: '2.0.5',
      now: at,
    });

    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      version: 1,
      marketId: 'kursunlu-ab12cd',
      marketName: 'Kurşunlu Market',
      appVersion: '2.0.5',
      exportedAt: '2026-11-09T18:30:00.000Z',
    });
    expect(Object.keys(backup.tables).sort()).toEqual(db.tables.map((table) => table.name).sort());
    expect(backup.tables.products).toEqual([expect.objectContaining({ id: milk.id, name: 'Süt' })]);
    expect(backup.tables.outbox).toHaveLength(unsent);
  });

  it('survives a trip through JSON unchanged', async () => {
    await createProduct(db, { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 }, at);
    const backup = await marketBackup(db, {
      marketId: 'kursunlu-ab12cd',
      marketName: 'Kurşunlu Market',
      appVersion: '2.0.5',
      now: at,
    });
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup);
  });
});

describe('backupFileName', () => {
  it('names the file after the market and the day in Istanbul', () => {
    // 23:30 in UTC is already the next day in Istanbul.
    expect(backupFileName('kursunlu-ab12cd', new Date('2026-11-09T23:30:00Z'))).toBe(
      'market-kasa-yedek-kursunlu-ab12cd-2026-11-10.json',
    );
  });
});
