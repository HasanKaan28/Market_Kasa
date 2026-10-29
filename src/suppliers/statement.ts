import type { MarketDb } from '@/data/db';
import type { SupplierLedgerRecord, SupplierPaymentMethod, SupplierRecord } from '@/data/types';
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
};

export const SUPPLIER_METHOD_LABELS: Record<SupplierPaymentMethod, string> = {
  cash: 'nakit',
  bank: 'banka',
  card: 'kart',
  cheque: 'çek',
};

const byName = new Intl.Collator('tr');

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
  entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  let running = 0;
  return entries.map((entry) => {
    running += entry.amount;
    return { entry, description: describe(entry), balanceAfter: running };
  });
}

/** "Fatura F-77" for a delivery on account, "Ödeme (banka): havale" for a payment. */
function describe(entry: SupplierLedgerRecord): string {
  if (entry.kind === 'invoice') {
    // A delivery on account carries its invoice number as the note.
    return entry.note ? `Fatura ${entry.note}` : 'Mal kabul';
  }
  const paid = entry.method ? `Ödeme (${SUPPLIER_METHOD_LABELS[entry.method]})` : 'Ödeme';
  return entry.note ? `${paid}: ${entry.note}` : paid;
}
