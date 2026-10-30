import { formatTRY, type Kurus } from '@/domain/money';
import type { Summary } from './summary';

/** One headline figure: a label, its value and, where it helps, a line under it. */
export type Figure = { label: string; value: string; note?: string };

export const percentFormat = new Intl.NumberFormat('tr-TR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** An amount that can fall below zero, with a real minus sign: "−₺12,50". */
export function formatAmount(amount: Kurus): string {
  return amount < 0 ? `−${formatTRY(-amount)}` : formatTRY(amount);
}

/** "29.10.2026", or "26.10.2026 – 29.10.2026" for more than one business day. */
export function formatPeriod(from: string, to: string): string {
  const day = (iso: string) => iso.split('-').reverse().join('.');
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

/**
 * The headline figures of a report, net sales first, then in rows of three: the sales, how they
 * were paid, and what came off them. Without `cost`, gross profit is left out (DESIGN §8.5).
 */
export function reportFigures(
  summary: Summary,
  { cost = true }: { cost?: boolean } = {},
): Figure[] {
  const margin = summary.net > 0 ? percentFormat.format(summary.grossProfit / summary.net) : null;
  const figures: Figure[] = [
    {
      label: 'Net satış',
      value: formatAmount(summary.net),
      note: `İade öncesi satış ${formatAmount(summary.gross)}`,
    },
    { label: 'İşlem', value: String(summary.salesCount) },
    { label: 'Ortalama sepet', value: formatAmount(summary.averageBasket) },
    {
      label: 'Brüt kâr',
      value: formatAmount(summary.grossProfit),
      ...(margin ? { note: `Kâr oranı ${margin}` } : {}),
    },
    { label: 'Nakit', value: formatAmount(summary.byMethod.cash) },
    { label: 'Kart', value: formatAmount(summary.byMethod.card) },
    { label: 'Veresiye', value: formatAmount(summary.byMethod.credit) },
    { label: 'İndirim', value: formatAmount(summary.discounts) },
    {
      label: 'İade',
      value: formatAmount(summary.returnTotal),
      note: `${summary.returnCount} iade`,
    },
    { label: 'İptal', value: formatAmount(summary.voidTotal), note: `${summary.voidCount} fiş` },
  ];
  return cost ? figures : figures.filter((figure) => figure.label !== 'Brüt kâr');
}
