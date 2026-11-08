import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { recordCount } from '@/data/counts';
import { pendingCount, pendingOps } from '@/data/outbox';
import { createProduct, deleteProduct, findProductByBarcode, updateProduct } from '@/data/products';
import { recordReturn, returnedQuantities } from '@/data/returns';
import { recordSale } from '@/data/sales';
import { loadMarketSettings, saveMarketSettings } from '@/data/settings';
import { stockOf } from '@/data/stock';
import { isVoided, voidSale } from '@/data/voids';
import { makeTestDb } from '@/test/db';
import { SERVERS, type TestBackend } from '@/test/servers';
import { syncOnce } from './engine';
import type { SyncTransport } from './protocol';

const at = new Date('2026-10-30T09:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);

async function sellMilk(db: MarketDb, when = at) {
  const milk =
    (await findProductByBarcode(db, 'B1')) ??
    (await createProduct(db, { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 }, when));
  const sale = await recordSale(db, {
    deviceCode: 'K1',
    at: when,
    lines: [{ productId: milk.id, qtyMilli: 2000 }],
    payments: [{ method: 'cash', amount: 8500 }],
  });
  return { milk, sale };
}

describe.each(SERVERS)('the $name server', ({ make }) => {
  let backend: TestBackend;
  let a: MarketDb;
  let b: MarketDb;
  let toA: SyncTransport;
  let toB: SyncTransport;

  beforeEach(async () => {
    backend = await make();
    a = makeTestDb();
    b = makeTestDb();
    toA = await backend.device();
    toB = await backend.device();
  });
  afterEach(async () => {
    await a.delete();
    await b.delete();
  });

  it('applies an operation once', async () => {
    await sellMilk(a);
    const ops = await pendingOps(a);
    await toA.push({ ops });
    const again = await toA.push({ ops });

    expect(again.acknowledged).toHaveLength(ops.length);
    expect(await backend.rows('stockMovements')).toHaveLength(1);
    expect(await backend.rows('sales')).toHaveLength(1);
  });

  it('survives a lost acknowledgement', async () => {
    await sellMilk(a);
    backend.loseNextAck();
    await expect(syncOnce(a, toA)).rejects.toThrow();
    expect(await pendingCount(a)).toBe(3);

    await syncOnce(a, toA);
    expect(await pendingCount(a)).toBe(0);
    expect(await backend.rows('sales')).toHaveLength(1);
    expect(await backend.rows('stockMovements')).toHaveLength(1);
  });

  it('merges a second insert of a record', async () => {
    await saveMarketSettings(a, { cutoffMinutes: 60 }, at);
    await saveMarketSettings(b, { cutoffMinutes: 120 }, later(1));
    await syncOnce(a, toA);
    await syncOnce(b, toB);
    await syncOnce(a, toA);

    expect(await loadMarketSettings(a)).toEqual({ cutoffMinutes: 120 });
    expect(await loadMarketSettings(b)).toEqual({ cutoffMinutes: 120 });
  });

  it('lets a deleted product give up its barcode', async () => {
    const old = await createProduct(
      a,
      { barcode: 'B9', name: 'Eski', sellPrice: 100, vatRate: 1 },
      at,
    );
    await deleteProduct(a, old.id, later(1));
    const live = await createProduct(
      b,
      { barcode: 'B9', name: 'Yeni', sellPrice: 200, vatRate: 1 },
      later(2),
    );
    expect(old.id < live.id).toBe(true);
    for (const [db, to] of [
      [a, toA],
      [b, toB],
      [a, toA],
    ] as const) {
      await syncOnce(db, to);
    }

    const held = (await backend.rows('products')).filter((row) => row.barcode === 'B9');
    expect(held.map((row) => row.id)).toEqual([live.id]);
    for (const db of [a, b]) {
      expect((await findProductByBarcode(db, 'B9'))?.id).toBe(live.id);
    }
  });

  it('accepts a sale’s records before the sale', async () => {
    const { milk } = await sellMilk(a);
    const ops = await pendingOps(a);
    const reply = await toA.push({ ops: [...ops].reverse() });
    expect(reply.acknowledged).toHaveLength(3);

    await syncOnce(b, toB);
    expect(await b.sales.count()).toBe(1);
    expect(await stockOf(b, milk.id)).toBe(-2000);
  });

  it('counts a void and a return that arrive before their sale', async () => {
    const first = await sellMilk(a);
    const second = await sellMilk(a, later(1));
    await voidSale(a, { saleId: first.sale.id, reason: 'Yanlış', deviceCode: 'K1', at: later(2) });
    await recordReturn(a, {
      saleId: second.sale.id,
      lines: [{ productId: first.milk.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: later(3),
    });
    const ops = await pendingOps(a);
    const sales = ops.filter((op) => op.table === 'sales');
    const rest = ops.filter((op) => op.table !== 'sales');
    await toA.push({ ops: [...rest, ...sales] });

    await syncOnce(b, toB);
    expect(await isVoided(b, first.sale.id)).toBe(true);
    expect((await returnedQuantities(b, second.sale.id)).get(first.milk.id)).toBe(1000);
    expect(await stockOf(b, first.milk.id)).toBe(await stockOf(a, first.milk.id));
  });

  it('agrees when two registers count the same product', async () => {
    const { milk } = await sellMilk(a);
    await syncOnce(a, toA);
    await syncOnce(b, toB);
    await recordCount(
      a,
      { deviceCode: 'K1', lines: [{ productId: milk.id, countedMilli: 5000 }] },
      later(1),
    );
    await recordCount(
      b,
      { deviceCode: 'K2', lines: [{ productId: milk.id, countedMilli: 7000 }] },
      later(2),
    );
    for (const [db, to] of [
      [a, toA],
      [b, toB],
      [a, toA],
    ] as const) {
      await syncOnce(db, to);
    }

    expect(await stockOf(a, milk.id)).toBe(await stockOf(b, milk.id));
    const counted = (await backend.rows('stockMovements')).filter((row) => row.kind === 'count');
    expect(counted).toHaveLength(2);
    expect(await backend.rows('stockCounts')).toHaveLength(2);
  });

  it('keeps a retried edit from hiding a later one', async () => {
    // No overlap: a cursor that never looks back must still see the later edit.
    const tight = { batchSize: 1, overlap: 0 };
    const milk = await createProduct(
      a,
      { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 },
      at,
    );
    await syncOnce(a, toA, tight);
    await syncOnce(b, toB, tight);
    await updateProduct(a, milk.id, { sellPrice: 100 }, later(1));
    await updateProduct(b, milk.id, { sellPrice: 101 }, later(2));
    // A's edit lands but its answer is lost; B's later edit lands; A's retry is lost again.
    backend.loseNextAck();
    await syncOnce(a, toA, tight).catch(() => undefined);
    await syncOnce(b, toB, tight);
    backend.loseNextAck();
    await syncOnce(a, toA, tight).catch(() => undefined);
    for (const [db, to] of [
      [a, toA],
      [b, toB],
      [a, toA],
    ] as const) {
      await syncOnce(db, to, tight);
    }

    const [server] = await backend.rows('products');
    expect(server?.sellPrice).toBe(101);
    expect((await a.products.get(milk.id))?.sellPrice).toBe(101);
    expect((await b.products.get(milk.id))?.sellPrice).toBe(101);
  });
});
