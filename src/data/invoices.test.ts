import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { InvoiceExistsError, InvoiceStateError, SaleVoidedError } from './errors';
import {
  applyInvoiceResult,
  cancelInvoice,
  invoiceForSale,
  requestInvoice,
  retryInvoice,
} from './invoices';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import { recordSale } from './sales';
import type { InvoiceBuyer, SaleRecord } from './types';
import { voidSale } from './voids';

let db: MarketDb;
let sale: SaleRecord;
const at = new Date('2026-10-30T09:00:00Z');
const later = new Date('2026-10-30T10:00:00Z');
const person: InvoiceBuyer = { kind: 'person', name: 'Ayşe Yılmaz', tckn: '10000000146' };
const company: InvoiceBuyer = {
  kind: 'company',
  title: 'Kurşunlu Gıda Ltd. Şti.',
  vkn: '1234567890',
  taxOffice: 'Kurşunlu',
  address: 'Çarşı Mah. 1. Sok. No: 3\nKurşunlu / Çankırı',
};

beforeEach(async () => {
  db = makeTestDb();
  const product = await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at);
  sale = await recordSale(db, {
    deviceCode: 'K1',
    at,
    lines: [{ productId: product.id, qtyMilli: 2000 }],
    payments: [{ method: 'cash', amount: 3000 }],
  });
});
afterEach(async () => {
  await db.delete();
});

describe('invoice requests', () => {
  it('asks for one invoice per sale', async () => {
    const invoice = await requestInvoice(
      db,
      { saleId: sale.id, buyer: company, deviceCode: 'K1', staffId: 's1' },
      at,
    );
    expect(invoice).toMatchObject({
      saleId: sale.id,
      buyer: company,
      status: 'pending',
      deviceCode: 'K1',
      staffId: 's1',
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
    expect(await invoiceForSale(db, sale.id)).toEqual(invoice);
    const ops = await pendingOps(db);
    expect(ops.at(-1)).toMatchObject({
      kind: 'insert',
      table: 'invoices',
      recordId: invoice.id,
      record: invoice,
    });

    await expect(
      requestInvoice(db, { saleId: sale.id, buyer: person, deviceCode: 'K1' }, later),
    ).rejects.toBeInstanceOf(InvoiceExistsError);

    // Once cancelled, the sale can be invoiced again.
    await cancelInvoice(db, invoice.id, later);
    expect(await invoiceForSale(db, sale.id)).toBeUndefined();
    const again = await requestInvoice(
      db,
      { saleId: sale.id, buyer: person, deviceCode: 'K1' },
      later,
    );
    expect(await invoiceForSale(db, sale.id)).toEqual(again);
  });

  it('refuses a voided sale and a buyer that does not check out', async () => {
    await expect(
      requestInvoice(
        db,
        { saleId: sale.id, buyer: { ...company, vkn: '1234567891' }, deviceCode: 'K1' },
        at,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      requestInvoice(
        db,
        { saleId: sale.id, buyer: { ...person, tckn: '10000000147' }, deviceCode: 'K1' },
        at,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      requestInvoice(
        db,
        { saleId: sale.id, buyer: { ...company, taxOffice: ' ' }, deviceCode: 'K1' },
        at,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      requestInvoice(
        db,
        { saleId: sale.id, buyer: { kind: 'person', name: '  ' }, deviceCode: 'K1' },
        at,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // A person without an identity number is fine; the names are kept trimmed.
    const plain = await requestInvoice(
      db,
      { saleId: sale.id, buyer: { kind: 'person', name: ' Ali Veli ' }, deviceCode: 'K1' },
      at,
    );
    expect(plain.buyer).toEqual({ kind: 'person', name: 'Ali Veli' });
    await cancelInvoice(db, plain.id, at);

    await voidSale(db, { saleId: sale.id, reason: 'Yanlış', deviceCode: 'K1', at });
    await expect(
      requestInvoice(db, { saleId: sale.id, buyer: person, deviceCode: 'K1' }, later),
    ).rejects.toBeInstanceOf(SaleVoidedError);
  });

  it('retries a failed request and cancels one not yet issued', async () => {
    const invoice = await requestInvoice(
      db,
      { saleId: sale.id, buyer: person, deviceCode: 'K1' },
      at,
    );
    // Only a failed request is retried.
    await expect(retryInvoice(db, invoice.id, later)).rejects.toBeInstanceOf(InvoiceStateError);

    const failed = await applyInvoiceResult(
      db,
      invoice.id,
      { ok: false, error: 'VKN doğrulanamadı' },
      later,
    );
    expect(failed).toMatchObject({ status: 'failed', error: 'VKN doğrulanamadı' });

    const retried = await retryInvoice(db, invoice.id, later);
    expect(retried.status).toBe('pending');
    expect(retried).not.toHaveProperty('error');
    const ops = await pendingOps(db);
    expect(ops.at(-1)).toMatchObject({
      kind: 'patch',
      table: 'invoices',
      recordId: invoice.id,
      patch: { status: 'pending', error: null, updatedAt: later.toISOString() },
    });

    const issued = await applyInvoiceResult(db, invoice.id, { ok: true, ettn: 'E-1' }, later);
    expect(issued).toMatchObject({ status: 'issued', ettn: 'E-1' });
    // An issued invoice is cancelled through the provider, never here.
    await expect(cancelInvoice(db, invoice.id, later)).rejects.toBeInstanceOf(InvoiceStateError);
    await expect(
      applyInvoiceResult(db, invoice.id, { ok: false, error: 'x' }, later),
    ).rejects.toBeInstanceOf(InvoiceStateError);

    const other = await requestInvoice(
      db,
      { saleId: sale.id, buyer: person, deviceCode: 'K1' },
      later,
    ).catch((error: unknown) => error);
    expect(other).toBeInstanceOf(InvoiceExistsError);
  });

  it('cancels a pending request', async () => {
    const invoice = await requestInvoice(
      db,
      { saleId: sale.id, buyer: person, deviceCode: 'K1' },
      at,
    );
    const cancelled = await cancelInvoice(db, invoice.id, later);
    expect(cancelled.status).toBe('cancelled');
    expect(await db.invoices.get(invoice.id)).toEqual(cancelled);
    await expect(cancelInvoice(db, invoice.id, later)).rejects.toBeInstanceOf(InvoiceStateError);
  });
});
