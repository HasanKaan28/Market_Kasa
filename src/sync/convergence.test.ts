import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { DuplicateBarcodeError } from '@/data/errors';
import { createProduct, findProductByBarcode, updateProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { stockOf } from '@/data/stock';
import { makeTestDb } from '@/test/db';
import { syncOnce } from './engine';
import { FakeServer } from './fakeServer';

type Command =
  | { type: 'sale'; device: number; product: number; qty: number }
  | { type: 'price'; device: number; product: number; price: number }
  | { type: 'newProduct'; device: number; barcode: 'N1' | 'N2' }
  | { type: 'sync'; device: number };

const SEED_BARCODES = ['B1', 'B2', 'B3'] as const;
const DEVICE_CODES = ['K1', 'K2', 'K3'] as const;

const deviceIndex = fc.integer({ min: 0, max: 2 });
const productIndex = fc.integer({ min: 0, max: 2 });
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    type: fc.constant('sale' as const),
    device: deviceIndex,
    product: productIndex,
    qty: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({
    type: fc.constant('price' as const),
    device: deviceIndex,
    product: productIndex,
    price: fc.integer({ min: 100, max: 10000 }),
  }),
  fc.record({
    type: fc.constant('newProduct' as const),
    device: deviceIndex,
    barcode: fc.constantFrom('N1' as const, 'N2' as const),
  }),
  fc.record({ type: fc.constant('sync' as const), device: deviceIndex }),
);

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`No item at ${index}`);
  }
  return item;
}

async function runCommand(
  step: Command,
  dbs: readonly MarketDb[],
  server: FakeServer,
  tick: () => Date,
): Promise<void> {
  const db = at(dbs, step.device);
  if (step.type === 'sync') {
    await syncOnce(db, server);
    return;
  }
  if (step.type === 'newProduct') {
    try {
      await createProduct(
        db,
        { barcode: step.barcode, name: step.barcode, sellPrice: 500, vatRate: 1 },
        tick(),
      );
    } catch (error) {
      if (!(error instanceof DuplicateBarcodeError)) throw error;
    }
    return;
  }
  const product = await findProductByBarcode(db, at(SEED_BARCODES, step.product));
  if (!product) {
    return;
  }
  if (step.type === 'price') {
    await updateProduct(db, product.id, { sellPrice: step.price }, tick());
    return;
  }
  await recordSale(db, {
    deviceCode: at(DEVICE_CODES, step.device),
    at: tick(),
    lines: [{ productId: product.id, qtyMilli: step.qty * 1000 }],
    payments: [{ method: 'cash', amount: product.sellPrice * step.qty }],
  });
}

async function expectConverged(dbs: readonly MarketDb[], server: FakeServer): Promise<void> {
  const serverProducts = server.rows('products');
  const barcodes = serverProducts.flatMap((p) =>
    typeof p.barcode === 'string' ? [p.barcode] : [],
  );
  expect(new Set(barcodes).size).toBe(barcodes.length);
  const serverMovements = server.rows('stockMovements');
  const serverSales = server.rows('sales');
  const summary = (p: Record<string, unknown>) => ({
    id: p.id,
    sellPrice: p.sellPrice,
    barcode: p.barcode,
  });

  for (const db of dbs) {
    const local = (await db.products.toArray()).sort((a, b) => a.id.localeCompare(b.id));
    expect(local.map(summary)).toEqual(serverProducts.map(summary));
    for (const product of serverProducts) {
      const expected = serverMovements
        .filter((m) => m.productId === product.id)
        .reduce((sum, m) => sum + Number(m.delta), 0);
      expect(await stockOf(db, String(product.id))).toBe(expected);
    }
    const localSales = await db.sales.toArray();
    expect(localSales).toHaveLength(serverSales.length);
    expect(new Set(localSales.map((s) => s.receiptNo)).size).toBe(localSales.length);
  }
}

describe('multi-device sync', () => {
  it('converges every device to the server', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(command, { maxLength: 25 }), async (commands) => {
        const server = new FakeServer();
        const dbs = DEVICE_CODES.map(() => makeTestDb());
        try {
          let clock = Date.parse('2026-10-29T06:00:00Z');
          const tick = () => new Date((clock += 60_000));
          for (const barcode of SEED_BARCODES) {
            await createProduct(
              at(dbs, 0),
              { barcode, name: barcode, sellPrice: 1000, vatRate: 1 },
              tick(),
            );
          }
          for (const db of dbs) await syncOnce(db, server);
          for (const step of commands) await runCommand(step, dbs, server, tick);
          for (let round = 0; round < 2; round += 1) {
            for (const db of dbs) await syncOnce(db, server);
          }
          await expectConverged(dbs, server);
        } finally {
          await Promise.all(dbs.map((db) => db.delete()));
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);
});
