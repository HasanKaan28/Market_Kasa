import type { MarketDb } from '@/data/db';
import { applyInvoiceResult, type InvoiceResult } from '@/data/invoices';
import type { InvoiceRecord } from '@/data/types';

/**
 * Settles every pending request with what `decide` says the provider made of it, and returns how
 * many it settled. It stands in for the server's provider adapter (M0b) in tests and development;
 * the real results come with the pull.
 */
export async function settlePending(
  db: MarketDb,
  decide: (invoice: InvoiceRecord) => InvoiceResult,
  at: Date,
): Promise<number> {
  const pending = await db.invoices.where('status').equals('pending').toArray();
  for (const invoice of pending) {
    await applyInvoiceResult(db, invoice.id, decide(invoice), at);
  }
  return pending.length;
}
