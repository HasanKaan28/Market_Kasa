import type { ProductUnit } from '@/data/types';

/** "10*", "1,5*" or "3*süt" at the start of the search: how many of the next product, and the rest. */
const MULTIPLIER = /^\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*[*×]\s*(.*)$/s;

/**
 * The count typed before a star in the register's search, in thousandths, and what follows it
 * (still a search or a barcode). Null when the text does not start with a count and a star.
 */
export function readMultiplier(text: string): { qtyMilli: number; rest: string } | null {
  const match = MULTIPLIER.exec(text);
  if (!match?.[1]) {
    return null;
  }
  const qtyMilli = Math.round(Number(match[1].replace(',', '.')) * 1000);
  return qtyMilli > 0 ? { qtyMilli, rest: match[2]?.trim() ?? '' } : null;
}

/** A product sold by the piece takes whole numbers only; one sold by weight takes any amount. */
export function fitsUnit(qtyMilli: number, unit: ProductUnit): boolean {
  return unit === 'kg' || qtyMilli % 1000 === 0;
}
