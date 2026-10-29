import type { PaymentMethod } from '@/data/types';

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

/** "14:32" in the market's time zone. */
export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/** A quantity in thousandths as the cashier reads it: "2", "1,5". */
export function formatQty(qtyMilli: number): string {
  return (qtyMilli / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
}
