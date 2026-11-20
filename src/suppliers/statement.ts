import { reversedPurchaseIds } from '@/data/corrections';
import type { MarketDb } from '@/data/db';
import type { SupplierLedgerRecord, SupplierPaymentMethod, SupplierRecord } from '@/data/types';
import { formatBalance } from '@/customers/statement';
import { documentDay } from '@/data/supplierLedger';
import type { Kurus } from '@/domain/money';

export type SupplierSummary = {
  /** Archived suppliers are here only while the market still owes them or is owed. */
  supplier: SupplierRecord;
  /** What the market owes the supplier; below zero is an overpayment. */
  balance: Kurus;
};

export type SupplierStatementLine = {
  entry: SupplierLedgerRecord;
  description: string;
  balanceAfter: Kurus;
  /**
   * Taken back: an invoice whose goods receipt was reversed, or a payment reversed. It stays in
   * the running balance, beside the counter-entry that takes it back, so every line still adds up.
   */
  reversed: boolean;
};

export const SUPPLIER_METHOD_LABELS: Record<SupplierPaymentMethod, string> = {
  cash: 'nakit',
  bank: 'banka',
  card: 'kart',
  cheque: 'çek',
};

/** An overpayment is credit the supplier owes back. */
export const SUPPLIER_CREDIT_LABEL = 'Fazla ödeme';

const byName = new Intl.Collator('tr');

/** "₺300,00" owed to the supplier, "Fazla ödeme ₺50,00" when it was overpaid. */
export function formatSupplierBalance(amount: Kurus): string {
  return formatBalance(amount, SUPPLIER_CREDIT_LABEL);
}

/** Every supplier with what the market owes them, by name. */
export async function supplierSummaries(db: MarketDb): Promise<SupplierSummary[]> {
  const [suppliers, ledger] = await Promise.all([
    db.suppliers.toArray(),
    db.supplierLedger.toArray(),
  ]);
  const balances = new Map<string, Kurus>();
  for (const entry of ledger) {
    balances.set(entry.supplierId, (balances.get(entry.supplierId) ?? 0) + entry.amount);
  }
  return suppliers
    .map((supplier) => ({ supplier, balance: balances.get(supplier.id) ?? 0 }))
    .filter((row) => !row.supplier.archivedAt || row.balance !== 0)
    .sort((a, b) => byName.compare(a.supplier.name, b.supplier.name));
}

/** A supplier's ledger oldest first, each entry described and followed by the balance it leaves. */
export async function supplierStatement(
  db: MarketDb,
  supplierId: string,
): Promise<SupplierStatementLine[]> {
  const entries = await db.supplierLedger.where('supplierId').equals(supplierId).toArray();
  // By the documents' own dates: an invoice typed in a day late goes where it belongs.
  entries.sort(
    (a, b) =>
      documentDay(a).localeCompare(documentDay(b)) ||
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.id.localeCompare(b.id),
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reversedIds = new Set(entries.flatMap((entry) => entry.reversesId ?? []));
  const voided = await reversedPurchaseIds(
    db,
    entries.flatMap((entry) => (entry.kind === 'invoice' ? (entry.purchaseId ?? []) : [])),
  );
  let running = 0;
  return entries.map((entry) => {
    running += entry.amount;
    return {
      entry,
      description: describeLine(entry, byId),
      balanceAfter: running,
      reversed:
        reversedIds.has(entry.id) ||
        (entry.kind === 'invoice' &&
          entry.purchaseId !== undefined &&
          voided.has(entry.purchaseId)),
    };
  });
}

/** A counter-entry names what it takes back, and why; every other entry is described as it is. */
function describeLine(
  entry: SupplierLedgerRecord,
  byId: ReadonlyMap<string, SupplierLedgerRecord>,
): string {
  const target = entry.reversesId === undefined ? undefined : byId.get(entry.reversesId);
  const reversing =
    entry.reversesId !== undefined || (entry.kind === 'adjustment' && entry.purchaseId);
  if (!reversing) {
    return describe(entry);
  }
  // The invoice of a receipt reversed on another register may not have arrived yet.
  const what = target ? describe(target) : entry.purchaseId ? 'Mal kabul' : 'Ödeme';
  return entry.note ? `Geri alma: ${what} · ${entry.note}` : `Geri alma: ${what}`;
}

/** "Fatura F-77" for a delivery on account, "Ödeme (banka): havale" for a payment. */
function describe(entry: SupplierLedgerRecord): string {
  if (entry.kind === 'adjustment') {
    return entry.note ? `Düzeltme: ${entry.note}` : 'Düzeltme';
  }
  if (entry.kind === 'invoice') {
    // A delivery on account carries its invoice number as the note.
    return entry.note ? `Fatura ${entry.note}` : 'Mal kabul';
  }
  const paid = entry.method ? `Ödeme (${SUPPLIER_METHOD_LABELS[entry.method]})` : 'Ödeme';
  return entry.note ? `${paid}: ${entry.note}` : paid;
}
