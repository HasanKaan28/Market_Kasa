import type { MarketDb } from '@/data/db';
import { documentDay } from '@/data/supplierLedger';
import type { PurchaseRecord, SaleRecord } from '@/data/types';
import type { Kurus } from '@/domain/money';
import { PAYMENT_LABELS } from '@/pos/format';
import { PURCHASE_PAYMENT_LABELS } from '@/suppliers/labels';

export type DocumentKind = 'sale' | 'purchase';

type DocumentFields = {
  id: string;
  /** The day it belongs to, `YYYY-MM-DD`: a sale's business day, an invoice's own date. */
  day: string;
  occurredAt: string;
  /** The receipt number of a sale, the invoice number of a goods receipt. */
  number?: string;
  /** The customer of a sale or the supplier of a receipt, when there is one. */
  counterparty?: string;
  /** How it was paid, as the shop says it: "Nakit", "Nakit + Kart", "Veresiye". */
  payment: string;
  total: Kurus;
  /** A voided sale or a receipt taken back: shown struck through, left out of the totals. */
  cancelled: boolean;
};

export type DocumentRow =
  | (DocumentFields & { kind: 'sale'; sale: SaleRecord; returned: boolean })
  | (DocumentFields & { kind: 'purchase'; purchase: PurchaseRecord });

export type DocumentTotals = Record<DocumentKind, { count: number; total: Kurus }>;

export type DocumentQuery = {
  /** First and last day of the range, `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
  kind: DocumentKind | 'all';
  /** False for a person who may not see what the market pays its suppliers. */
  purchases?: boolean;
};

/**
 * The market's sales (the register's receipts) and purchases (goods receipts) of a range of
 * days, newest first, with the totals of each kind over the range whatever the filter. A
 * purchase belongs to its invoice's own date, so one typed in a day late is listed where it
 * belongs; a sale to its business day.
 */
export async function listDocuments(
  db: MarketDb,
  { from, to, kind, purchases: withPurchases = true }: DocumentQuery,
): Promise<{ rows: DocumentRow[]; totals: DocumentTotals }> {
  const [sales, purchases] = await Promise.all([
    db.sales.where('businessDate').between(from, to, true, true).toArray(),
    withPurchases
      ? db.purchases.filter((purchase) => inRange(documentDay(purchase), from, to)).toArray()
      : Promise.resolve([]),
  ]);
  const saleIds = sales.map((sale) => sale.id);
  const purchaseIds = purchases.map((purchase) => purchase.id);
  const customerIds = [...new Set(sales.flatMap((sale) => sale.customerId ?? []))];
  const supplierIds = [...new Set(purchases.flatMap((purchase) => purchase.supplierId ?? []))];
  const [voids, returns, purchaseVoids, customers, suppliers] = await Promise.all([
    db.saleVoids.where('saleId').anyOf(saleIds).toArray(),
    db.returns.where('saleId').anyOf(saleIds).toArray(),
    db.purchaseVoids.where('purchaseId').anyOf(purchaseIds).toArray(),
    db.customers.bulkGet(customerIds),
    db.suppliers.bulkGet(supplierIds),
  ]);
  const voided = new Set(voids.map((record) => record.saleId));
  const returned = new Set(returns.map((record) => record.saleId));
  const reversed = new Set(purchaseVoids.map((record) => record.purchaseId));
  const customerNames = new Map(
    customers.flatMap((customer) => (customer ? [[customer.id, customer.name] as const] : [])),
  );
  const supplierNames = new Map(
    suppliers.flatMap((supplier) => (supplier ? [[supplier.id, supplier.name] as const] : [])),
  );

  const all: DocumentRow[] = [
    ...sales.map((sale): DocumentRow => ({
      kind: 'sale',
      id: sale.id,
      day: sale.businessDate,
      occurredAt: sale.occurredAt,
      number: sale.receiptNo,
      counterparty: sale.customerId ? customerNames.get(sale.customerId) : undefined,
      payment: [...new Set(sale.payments.map((payment) => PAYMENT_LABELS[payment.method]))].join(
        ' + ',
      ),
      total: sale.total,
      cancelled: voided.has(sale.id),
      returned: returned.has(sale.id),
      sale,
    })),
    ...purchases.map((purchase): DocumentRow => ({
      kind: 'purchase',
      id: purchase.id,
      day: documentDay(purchase),
      occurredAt: purchase.occurredAt,
      number: purchase.invoiceNo,
      counterparty: purchase.supplierId ? supplierNames.get(purchase.supplierId) : undefined,
      payment: PURCHASE_PAYMENT_LABELS[purchase.payment ?? 'cash'],
      total: purchase.total,
      cancelled: reversed.has(purchase.id),
      purchase,
    })),
  ];
  all.sort(
    (a, b) =>
      b.day.localeCompare(a.day) ||
      b.occurredAt.localeCompare(a.occurredAt) ||
      b.id.localeCompare(a.id),
  );

  const totals: DocumentTotals = {
    sale: { count: 0, total: 0 },
    purchase: { count: 0, total: 0 },
  };
  for (const row of all) {
    if (!row.cancelled) {
      totals[row.kind].count += 1;
      totals[row.kind].total += row.total;
    }
  }
  return { rows: kind === 'all' ? all : all.filter((row) => row.kind === kind), totals };
}

function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}
