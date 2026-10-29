import type { SaleRecord } from '@/data/types';
import { formatTRY, type Kurus } from '@/domain/money';
import { lineTotal } from '@/domain/pricing';
import { formatQty, PAYMENT_LABELS } from './format';

export type ReceiptRow = { label: string; amount: string };

export type ReceiptLine = { name: string; detail: string; discount?: string; amount: string };

/** Everything printed on a receipt, already formatted; the screen, paper and text draw from it. */
export type ReceiptModel = {
  header: string[];
  device: string;
  receiptNo: string;
  dateTime: string;
  lines: ReceiptLine[];
  totals: ReceiptRow[];
  vat: ReceiptRow[];
  payments: ReceiptRow[];
  customer?: string;
  marks: string[];
  footer: string[];
};

export type ReceiptContext = {
  marketName: string;
  deviceName: string;
  header?: string;
  footer?: string;
  customerName?: string;
  status?: { voided: boolean; returnedAny: boolean };
};

const NOT_FISCAL = 'Bilgi fişidir, mali değeri yoktur.';

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

/**
 * The receipt of a stored sale. Lines show their own discount only and the cart discount comes
 * after Ara toplam, so the printed figures add up as written (the M2c cart layout).
 */
export function buildReceipt(sale: SaleRecord, context: ReceiptContext): ReceiptModel {
  const amounts = sale.lines.map(
    (line) => lineTotal(line.qtyMilli, line.unitPrice) - line.lineDiscount,
  );
  const lines: ReceiptLine[] = sale.lines.map((line, index) => ({
    name: line.name,
    detail: `${formatQty(line.qtyMilli)} × ${formatTRY(line.unitPrice)}`,
    ...(line.lineDiscount > 0 ? { discount: `İndirim −${formatTRY(line.lineDiscount)}` } : {}),
    amount: formatTRY(amounts[index] ?? 0),
  }));
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0);
  const totals: ReceiptRow[] = [
    { label: 'Ara toplam', amount: formatTRY(subtotal) },
    ...(sale.cartDiscount > 0
      ? [{ label: 'Sepet indirimi', amount: `−${formatTRY(sale.cartDiscount)}` }]
      : []),
    { label: 'Toplam', amount: formatTRY(sale.total) },
  ];
  const vat = Object.entries(sale.vatByRate)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([rate, amount]) => ({
      label: `KDV %${rate} (dahil)`,
      amount: formatTRY(amount as Kurus),
    }));
  return {
    header: [context.marketName, ...textLines(context.header)],
    device: context.deviceName,
    receiptNo: sale.receiptNo,
    dateTime: DATE_TIME.format(new Date(sale.occurredAt)),
    lines,
    totals,
    vat,
    payments: paymentRows(sale),
    ...(context.customerName ? { customer: `Müşteri: ${context.customerName}` } : {}),
    marks: [
      ...(context.status?.voided ? ['İPTAL EDİLDİ'] : []),
      ...(context.status?.returnedAny ? ['İADESİ VAR'] : []),
    ],
    footer: [...textLines(context.footer), NOT_FISCAL],
  };
}

function paymentRows(sale: SaleRecord): ReceiptRow[] {
  const rows = sale.payments.map((payment) => ({
    label: PAYMENT_LABELS[payment.method],
    amount: formatTRY(payment.amount),
  }));
  if (sale.cashGiven !== undefined) {
    rows.push(
      { label: 'Alınan', amount: formatTRY(sale.cashGiven) },
      { label: 'Para üstü', amount: formatTRY(sale.change) },
    );
  }
  return rows;
}

function textLines(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
