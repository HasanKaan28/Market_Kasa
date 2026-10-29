import type { PaymentMethod, ProductUnit } from '@/data/types';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Nakit',
  card: 'Kart',
  credit: 'Veresiye',
};

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

/** "29.10 14:32" in the market's time zone, for lists that span days. */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

/** "14:32" in the market's time zone. */
export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/** A quantity for an input field: no thousands grouping, so `parseQuantity` reads it back. */
export function formatQtyInput(qtyMilli: number): string {
  return (qtyMilli / 1000).toLocaleString('tr-TR', {
    maximumFractionDigits: 3,
    useGrouping: false,
  });
}

/** A quantity in thousandths as the cashier reads it: "2", "1,5". */
export function formatQty(qtyMilli: number): string {
  return (qtyMilli / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
}

export const UNIT_LABELS: Record<ProductUnit, string> = { piece: 'adet', kg: 'kg' };

/** Stock with its unit: "12 adet", "1,25 kg"; a shortfall gets a real minus sign, "−3 adet". */
export function formatStock(qtyMilli: number, unit: ProductUnit): string {
  const sign = qtyMilli < 0 ? '−' : '';
  return `${sign}${formatQty(Math.abs(qtyMilli))} ${UNIT_LABELS[unit]}`;
}

// Ten thousand units keeps quantity × unit price exact even at the highest allowed price.
const MAX_QUANTITY_MILLI = 10_000_000;
const PIECES = /^\d+$/;
const WEIGHT = /^\d+(?:[.,]\d{1,3})?$/;

/** A typed quantity in thousandths: whole pieces, or kilograms with up to three decimals. */
export function parseQuantity(text: string, unit: ProductUnit): number | null {
  const value = text.trim();
  if (!(unit === 'piece' ? PIECES : WEIGHT).test(value)) {
    return null;
  }
  const [whole = '0', fraction = ''] = value.split(/[.,]/);
  const qtyMilli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return qtyMilli > 0 && qtyMilli <= MAX_QUANTITY_MILLI ? qtyMilli : null;
}
