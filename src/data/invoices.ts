import { isValidTaxId, isValidTckn } from '@/domain/taxId';
import type { MarketDb } from './db';
import {
  InvoiceExistsError,
  InvoiceStateError,
  RecordNotFoundError,
  SaleVoidedError,
} from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { changedFields, toPatch, withoutUndefined } from './records';
import type { InvoiceBuyer, InvoiceRecord } from './types';

export type InvoiceRequestInput = {
  saleId: string;
  buyer: InvoiceBuyer;
  deviceCode: string;
  staffId?: string;
};

/** What the provider made of a request: issued with its ETTN, or refused with its reason. */
export type InvoiceResult = { ok: true; ettn: string } | { ok: false; error: string };

/**
 * Asks for an e-Arşiv invoice on a sale, queued for the server to issue. A sale has at most one
 * invoice that is not cancelled, and a voided sale gets none.
 */
export async function requestInvoice(
  db: MarketDb,
  input: InvoiceRequestInput,
  at: Date,
): Promise<InvoiceRecord> {
  const buyer = checkedBuyer(input.buyer);
  return db.transaction('rw', [db.sales, db.saleVoids, db.invoices, db.outbox], async () => {
    const sale = await db.sales.get(input.saleId);
    if (!sale) {
      throw new RecordNotFoundError('Sale', input.saleId);
    }
    if ((await db.saleVoids.where('saleId').equals(sale.id).count()) > 0) {
      throw new SaleVoidedError(sale.receiptNo);
    }
    if (await invoiceForSale(db, sale.id)) {
      throw new InvoiceExistsError(sale.id);
    }
    const stamp = at.toISOString();
    const record: InvoiceRecord = withoutUndefined({
      id: newId(at.getTime()),
      saleId: sale.id,
      buyer,
      status: 'pending' as const,
      deviceCode: input.deviceCode,
      staffId: input.staffId,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await db.invoices.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'invoices', recordId: record.id, record }, at);
    return record;
  });
}

/** The sale's invoice that is not cancelled, if it has one. */
export async function invoiceForSale(
  db: MarketDb,
  saleId: string,
): Promise<InvoiceRecord | undefined> {
  const invoices = await db.invoices.where('saleId').equals(saleId).toArray();
  return invoices.find((invoice) => invoice.status !== 'cancelled');
}

/** Sends a failed request again. */
export async function retryInvoice(db: MarketDb, id: string, at: Date): Promise<InvoiceRecord> {
  return changeInvoice(db, id, at, (current) => {
    if (current.status !== 'failed') {
      throw new InvoiceStateError(id, current.status, 'retried');
    }
    return { status: 'pending', error: undefined };
  });
}

/** Withdraws a request not yet issued; an issued invoice is cancelled through the provider. */
export async function cancelInvoice(db: MarketDb, id: string, at: Date): Promise<InvoiceRecord> {
  return changeInvoice(db, id, at, (current) => {
    if (current.status !== 'pending' && current.status !== 'failed') {
      throw new InvoiceStateError(id, current.status, 'cancelled');
    }
    return { status: 'cancelled' };
  });
}

/**
 * Records what the provider made of a pending request. On the server this is the provider
 * adapter's work and the result reaches the registers with the pull; here it stands in for it, in
 * tests and in development, so it queues nothing.
 */
export async function applyInvoiceResult(
  db: MarketDb,
  id: string,
  result: InvoiceResult,
  at: Date,
): Promise<InvoiceRecord> {
  return db.transaction('rw', db.invoices, async () => {
    const current = await db.invoices.get(id);
    if (!current) {
      throw new RecordNotFoundError('Invoice', id);
    }
    if (current.status !== 'pending') {
      throw new InvoiceStateError(id, current.status, 'given a result');
    }
    const next: InvoiceRecord = withoutUndefined({
      ...current,
      ...(result.ok
        ? { status: 'issued' as const, ettn: result.ettn, error: undefined }
        : { status: 'failed' as const, error: result.error }),
      updatedAt: at.toISOString(),
    });
    await db.invoices.put(next);
    return next;
  });
}

/**
 * Withdraws the requests of a sale being voided that were not issued yet. An issued invoice stays:
 * only the provider can cancel it. It runs inside the caller's transaction, which must include
 * `invoices` and `outbox`.
 */
export async function withdrawInvoicesOf(db: MarketDb, saleId: string, at: Date): Promise<void> {
  const invoices = await db.invoices.where('saleId').equals(saleId).toArray();
  const stamp = at.toISOString();
  for (const invoice of invoices) {
    if (invoice.status !== 'pending' && invoice.status !== 'failed') {
      continue;
    }
    const changed = changedFields(invoice, { status: 'cancelled' as const });
    await db.invoices.put({ ...invoice, ...changed, updatedAt: stamp });
    await appendOutbox(
      db,
      { kind: 'patch', table: 'invoices', recordId: invoice.id, patch: toPatch(changed, stamp) },
      at,
    );
  }
}

async function changeInvoice(
  db: MarketDb,
  id: string,
  at: Date,
  change: (current: InvoiceRecord) => Partial<InvoiceRecord>,
): Promise<InvoiceRecord> {
  return db.transaction('rw', db.invoices, db.outbox, async () => {
    const current = await db.invoices.get(id);
    if (!current) {
      throw new RecordNotFoundError('Invoice', id);
    }
    const stamp = at.toISOString();
    const changed = changedFields(current, change(current));
    const next = withoutUndefined({ ...current, ...changed, updatedAt: stamp });
    await db.invoices.put(next);
    await appendOutbox(
      db,
      { kind: 'patch', table: 'invoices', recordId: id, patch: toPatch(changed, stamp) },
      at,
    );
    return next;
  });
}

/** The buyer with its text trimmed; a buyer whose details do not check out is refused. */
function checkedBuyer(buyer: InvoiceBuyer): InvoiceBuyer {
  if (buyer.kind === 'person') {
    const name = buyer.name.trim();
    const tckn = buyer.tckn?.trim() || undefined;
    if (name === '') {
      throw new RangeError('An invoice to a person needs their name');
    }
    if (tckn !== undefined && !isValidTckn(tckn)) {
      throw new RangeError(`Not a valid identity number: ${tckn}`);
    }
    return withoutUndefined({ kind: 'person' as const, name, tckn });
  }
  const checked = {
    kind: 'company' as const,
    title: buyer.title.trim(),
    taxId: buyer.taxId.trim(),
    taxOffice: buyer.taxOffice.trim(),
    address: buyer.address.trim(),
  };
  if (checked.title === '' || checked.taxOffice === '' || checked.address === '') {
    throw new RangeError('An invoice to a company needs its title, tax office and address');
  }
  if (!isValidTaxId(checked.taxId)) {
    throw new RangeError(`Not a valid tax number: ${checked.taxId}`);
  }
  return checked;
}
