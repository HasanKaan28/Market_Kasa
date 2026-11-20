import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { DuplicateBarcodeError } from '@/data/errors';
import { pendingCount } from '@/data/outbox';
import { createProduct, findProductByBarcode, updateProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { stockOf } from '@/data/stock';
import { makeTestDb } from '@/test/db';
import { SERVERS, type TestBackend } from '@/test/servers';
import { syncOnce, type SyncOptions } from './engine';
import type { SyncTransport } from './protocol';

type Command =
  | { type: 'sale'; device: number; product: number; qty: number }
  | { type: 'price'; device: number; product: number; price: number }
  | { type: 'newProduct'; device: number; barcode: 'N1' | 'N2' }
  | { type: 'sync'; device: number }
  | { type: 'lostAck'; device: number }
  | { type: 'writeDuringSync'; device: number; product: number };

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
  fc.record({ type: fc.constant('lostAck' as const), device: deviceIndex }),
  fc.record({
    type: fc.constant('writeDuringSync' as const),
    device: deviceIndex,
    product: productIndex,
  }),
);
const options: fc.Arbitrary<SyncOptions> = fc.record({
  batchSize: fc.integer({ min: 1, max: 7 }),
  overlap: fc.integer({ min: 0, max: 5 }),
});

/** A connection that makes a sale on the register after its push and before its pull. */
function writingBeforePull(transport: SyncTransport, write: () => Promise<void>): SyncTransport {
  let written = false;
  return {
    push: (request) => transport.push(request),
    async pull(request) {
      if (!written) {
        written = true;
        await write();
      }
      return transport.pull(request);
    },
  };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`No item at ${index}`);
  }
  return item;
}

type Registers = {
  dbs: readonly MarketDb[];
  links: readonly SyncTransport[];
  backend: TestBackend;
  options: SyncOptions;
};

async function sell(db: MarketDb, device: number, barcode: string, qty: number, when: Date) {
  const product = await findProductByBarcode(db, barcode);
  if (!product) {
    return;
  }
  await recordSale(db, {
    deviceCode: at(DEVICE_CODES, device),
    at: when,
    lines: [{ productId: product.id, qtyMilli: qty * 1000 }],
    payments: [{ method: 'cash', amount: product.sellPrice * qty }],
  });
}

async function runCommand(step: Command, registers: Registers, tick: () => Date): Promise<void> {
  const { dbs, links, backend, options } = registers;
  const db = at(dbs, step.device);
  const link = at(links, step.device);
  if (step.type === 'sync') {
    await syncOnce(db, link, options);
    return;
  }
  if (step.type === 'lostAck') {
    // Only a push can lose its answer; with nothing queued there is no push.
    if ((await pendingCount(db)) === 0) {
      return;
    }
    backend.loseNextAck();
    await syncOnce(db, link, options).catch(() => undefined);
    return;
  }
  if (step.type === 'writeDuringSync') {
    const write = () => sell(db, step.device, at(SEED_BARCODES, step.product), 1, tick());
    await syncOnce(db, writingBeforePull(link, write), options);
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
  await sell(db, step.device, at(SEED_BARCODES, step.product), step.qty, tick());
}

async function expectConverged(dbs: readonly MarketDb[], backend: TestBackend): Promise<void> {
  const serverProducts = await backend.rows('products');
  const barcodes = serverProducts.flatMap((p) =>
    typeof p.barcode === 'string' ? [p.barcode] : [],
  );
  expect(new Set(barcodes).size).toBe(barcodes.length);
  const serverMovements = await backend.rows('stockMovements');
  const serverSales = await backend.rows('sales');
  const summary = (p: Record<string, unknown>) => ({
    id: p.id,
    sellPrice: p.sellPrice,
    barcode: p.barcode,
  });

  for (const db of dbs) {
    const local = (await db.products.toArray()).sort((a, b) => (a.id < b.id ? -1 : 1));
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

describe.each(SERVERS)('multi-device sync on the $name server', ({ make }) => {
  it('converges every device to the server', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(command, { maxLength: 25 }), options, async (commands, opts) => {
        const backend = await make();
        const dbs = DEVICE_CODES.map(() => makeTestDb());
        const links = await Promise.all(DEVICE_CODES.map(() => backend.device()));
        const registers = { dbs, links, backend, options: opts };
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
          const syncAll = async () => {
            for (const [index, db] of dbs.entries()) await syncOnce(db, at(links, index), opts);
          };
          await syncAll();
          for (const step of commands) await runCommand(step, registers, tick);
          for (let round = 0; round < 2; round += 1) await syncAll();
          await expectConverged(dbs, backend);
        } finally {
          await Promise.all(dbs.map((db) => db.delete()));
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);
});
