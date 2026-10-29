import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { acknowledgeOps, pendingOps } from '@/data/outbox';
import { createProduct, updateProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { makeTestDb } from '@/test/db';
import { applyServerRows } from './apply';
import { parkedRows } from './issues';
import type { ServerRow, SyncTable } from './protocol';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const movement = {
  id: 'm1',
  productId: 'p1',
  delta: -2000,
  kind: 'sale',
  occurredAt: at.toISOString(),
  businessDate: '2026-10-29',
};

async function clearOutbox() {
  await acknowledgeOps(
    db,
    (await pendingOps(db)).map((op) => op.seq ?? -1),
  );
}

describe('applyServerRows', () => {
  it('inserts a foreign event once and updates the stock cache', async () => {
    const row = { table: 'stockMovements' as const, id: 'm1', serverSeq: 1, row: movement };
    await applyServerRows(db, [row]);
    await applyServerRows(db, [row]);
    expect(await stockOf(db, 'p1')).toBe(-2000);
    expect(await db.stockMovements.count()).toBe(1);
  });

  it('keeps a pending local edit on top of the server row', async () => {
    const p = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await clearOutbox();
    await updateProduct(db, p.id, { sellPrice: 4500 }, at);
    await applyServerRows(db, [
      {
        table: 'products',
        id: p.id,
        serverSeq: 2,
        row: { ...p, name: 'Süt 1 L', sellPrice: 5000 },
      },
    ]);
    expect(await db.products.get(p.id)).toMatchObject({ name: 'Süt 1 L', sellPrice: 4500 });
  });

  it('removes fields the server cleared', async () => {
    const p = await createProduct(
      db,
      { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
    );
    await clearOutbox();
    await applyServerRows(db, [
      { table: 'products', id: p.id, serverSeq: 3, row: { ...p, barcode: null } },
    ]);
    expect((await db.products.get(p.id))?.barcode).toBeUndefined();
  });

  it('clears a contested barcode on the local loser first', async () => {
    const base = {
      name: 'X',
      unit: 'piece',
      sellPrice: 100,
      buyPrice: 0,
      vatRate: 1,
      isQuick: false,
      criticalLevelMilli: 0,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    } as const;
    await db.products.add({ ...base, id: 'p-2', barcode: 'X' });
    await applyServerRows(db, [
      { table: 'products', id: 'p-1', serverSeq: 4, row: { ...base, id: 'p-1', barcode: 'X' } },
    ]);
    expect((await db.products.get('p-1'))?.barcode).toBe('X');
    expect((await db.products.get('p-2'))?.barcode).toBeUndefined();
  });

  it('stores two sales that share a receipt number', async () => {
    const sale = (id: string, serverSeq: number): ServerRow => ({
      table: 'sales',
      id,
      serverSeq,
      row: { id, receiptNo: 'K1-20261029-0001', deviceCode: 'K1', businessDate: '2026-10-29' },
    });
    await applyServerRows(db, [sale('s1', 1), sale('s2', 2)]);
    expect(await db.sales.count()).toBe(2);
  });

  it('sets aside rows it cannot apply and applies the rest', async () => {
    const rows: ServerRow[] = [
      { table: 'categories' as SyncTable, id: 'c1', serverSeq: 1, row: { id: 'c1' } },
      {
        table: 'stockMovements',
        id: 'm2',
        serverSeq: 2,
        row: { ...movement, id: 'm2', delta: '-1.000' },
      },
      {
        table: 'ledger',
        id: 'l1',
        serverSeq: 3,
        row: { customerId: 'c1', kind: 'debt', amount: 100 },
      },
      { table: 'stockMovements', id: 'm1', serverSeq: 4, row: movement },
    ];
    await applyServerRows(db, rows);
    expect(await stockOf(db, 'p1')).toBe(-2000);
    expect(await db.stockMovements.count()).toBe(1);
    expect((await parkedRows(db)).map((parked) => parked.row.serverSeq)).toEqual([1, 2, 3]);
  });
});
