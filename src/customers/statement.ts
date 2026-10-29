import type { MarketDb } from '@/data/db';
import type { CustomerRecord, LedgerMethod, LedgerRecord } from '@/data/types';
import { balance, debtAgeDays } from '@/domain/ledger';
import { formatTRY, type Kurus } from '@/domain/money';

export type CustomerSummary = {
  /** Archived customers are here only while they still owe or are owed. */
  customer: CustomerRecord;
  /** What the customer owes; below zero is credit the market owes back. */
  balance: Kurus;
  debtAgeDays: number;
};

export type StatementLine = {
  entry: LedgerRecord;
  description: string;
  /** The balance once this entry is counted. */
  balanceAfter: Kurus;
};

const METHOD_LABELS: Record<LedgerMethod, string> = { cash: 'nakit', card: 'kart' };

const byName = new Intl.Collator('tr');

/**
 * Every active customer with what they owe and since how many days, by name. An archived
 * customer whose balance moved after archiving (a return, another register's sale) is listed
 * too, so the balance is never out of sight.
 */
export async function customerSummaries(
  db: MarketDb,
  today: string,
  opts: { cutoffMinutes?: number } = {},
): Promise<CustomerSummary[]> {
  const [customers, ledger] = await Promise.all([db.customers.toArray(), db.ledger.toArray()]);
  const byCustomer = new Map<string, LedgerRecord[]>();
  for (const entry of ledger) {
    byCustomer.set(entry.customerId, [...(byCustomer.get(entry.customerId) ?? []), entry]);
  }
  return customers
    .map((customer) => {
      const entries = byCustomer.get(customer.id) ?? [];
      return {
        customer,
        balance: balance(entries),
        debtAgeDays: debtAgeDays(entries, today, opts),
      };
    })
    .filter((row) => !row.customer.archivedAt || row.balance !== 0)
    .sort((a, b) => byName.compare(a.customer.name, b.customer.name));
}

/** A customer's ledger oldest first, each entry described and followed by the balance it leaves. */
export async function customerStatement(
  db: MarketDb,
  customerId: string,
): Promise<StatementLine[]> {
  const entries = await db.ledger.where('customerId').equals(customerId).toArray();
  entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const saleIds = [...new Set(entries.flatMap((entry) => (entry.saleId ? [entry.saleId] : [])))];
  const sales = await db.sales.bulkGet(saleIds);
  const receipts = new Map(
    sales.flatMap((sale) => (sale ? [[sale.id, sale.receiptNo] as const] : [])),
  );
  let running = 0;
  return entries.map((entry) => {
    running += entry.amount;
    return { entry, description: describe(entry, receipts), balanceAfter: running };
  });
}

/**
 * "₺42,50" owed, "Alacak ₺20,00" when the market owes the customer. The supplier side names
 * its credit otherwise (`creditLabel`), as there it means the supplier owes the market.
 */
export function formatBalance(amount: Kurus, creditLabel = 'Alacak'): string {
  return amount < 0 ? `${creditLabel} ${formatTRY(-amount)}` : formatTRY(amount);
}

function describe(entry: LedgerRecord, receipts: ReadonlyMap<string, string>): string {
  const receipt = entry.saleId ? receipts.get(entry.saleId) : undefined;
  const withReceipt = (text: string) => (receipt ? `${text} ${receipt}` : text);
  switch (entry.kind) {
    case 'debt':
      return withReceipt('Satış');
    case 'payment': {
      const paid = entry.method ? `Tahsilat (${METHOD_LABELS[entry.method]})` : 'Tahsilat';
      return entry.note ? `${paid}: ${entry.note}` : paid;
    }
    case 'adjustment':
      // A void or a return names itself ("Satış iptali", "İade") and its sale.
      if (entry.saleId) {
        return withReceipt(entry.note ?? 'Düzeltme');
      }
      return entry.note ? `Düzeltme: ${entry.note}` : 'Düzeltme';
  }
}
