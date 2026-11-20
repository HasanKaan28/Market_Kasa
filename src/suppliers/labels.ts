import type { PurchasePayment, PurchaseRecord } from '@/data/types';

/** How a goods receipt was paid, as the supplier's invoice list says it. */
export const PURCHASE_PAYMENT_LABELS: Record<PurchasePayment, string> = {
  cash: 'Peşin',
  card: 'Kart',
  on_account: 'Veresiye',
};

/** "Fatura F-77", or "Numarasız fatura" when no number was typed. */
export const invoiceName = (purchase: PurchaseRecord) =>
  purchase.invoiceNo ? `Fatura ${purchase.invoiceNo}` : 'Numarasız fatura';
